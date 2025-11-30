const handleUpgradeToPro = async () => {
	const uid = auth.currentUser?.uid;
  
	if (!uid) {
	  Alert.alert(
		"Sign in required",
		"Please sign in to upgrade to the Pro plan.",
		[
		  {
			text: "Go to login",
			onPress: () => router.push("/login"),
		  },
		  { text: "Cancel", style: "cancel" },
		]
	  );
	  return;
	}
  
	try {
	  setUpgrading(true);
  
	  // 1) Create Xendit invoice via Cloudflare Worker
	  const res = await fetch(XENDIT_CREATE_URL, {
		method: "POST",
		headers: {
		  "Content-Type": "application/json",
		},
		body: JSON.stringify({
		  amount: 199, // adjust to your desired currency representation
		  description: "Receipt Manager Pro - Monthly Plan",
		  userId: uid,
		}),
	  });
  
	  if (!res.ok) {
		const text = await res.text();
		console.log("Xendit worker error:", text);
		throw new Error(text || "Failed to create invoice");
	  }
  
	  const data: any = await res.json();
	  const invoiceUrl = data?.invoice_url;
	  const invoiceId = data?.id;
  
	  if (!invoiceUrl || !invoiceId) {
		console.log("Invalid Xendit worker response:", data);
		throw new Error("Invoice data missing from server response");
	  }
  
	  // 2) Open Xendit hosted payment page
	  await WebBrowser.openBrowserAsync(invoiceUrl);
  
	  // 3) After browser is closed, ask our Worker for final status
	  const statusRes = await fetch(XENDIT_CHECK_URL, {
		method: "POST",
		headers: {
		  "Content-Type": "application/json",
		},
		body: JSON.stringify({ invoiceId }),
	  });
  
	  if (!statusRes.ok) {
		const text = await statusRes.text();
		console.log("Check invoice error:", text);
		throw new Error("Failed to verify payment status.");
	  }
  
	  const statusData: any = await statusRes.json();
	  const status = statusData?.status;
	  console.log("Invoice status:", status);
  
	  if (status === "PAID") {
		// 4) Mark user as paid in Realtime Database
		await set(ref(db, `users/${uid}/payment`), true);
  
		Alert.alert(
		  "Pro plan activated 🎉",
		  "Your payment was successful. You now have unlimited scans."
		);
	  } else {
		Alert.alert(
		  "Payment not completed",
		  "We didn't detect a successful payment yet. If you already paid, please wait a moment and try again."
		);
	  }
	} catch (err: any) {
	  console.error("Upgrade error:", err);
	  Alert.alert(
		"Upgrade failed",
		err?.message || "Something went wrong while upgrading your plan."
	  );
	} finally {
	  setUpgrading(false);
	}
  };
  