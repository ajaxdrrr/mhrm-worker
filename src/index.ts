export default {
	async fetch(request, env, ctx) {
	  const url = new URL(request.url);
  
	  // Handle CORS preflight for POST
	  if (request.method === "OPTIONS") {
		return new Response(null, {
		  status: 204,
		  headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
		  },
		});
	  }
  
	  const XENDIT_SECRET_KEY = env.XENDIT_SECRET_KEY;
	  if (!XENDIT_SECRET_KEY) {
		console.error("XENDIT_SECRET_KEY missing in env");
		return json(500, { error: "Xendit secret key not configured" });
	  }
  
	  // 1) Create Xendit invoice
	  if (url.pathname === "/create-xendit-invoice") {
		if (request.method !== "POST") {
		  return json(405, { error: "Method not allowed" });
		}
  
		let body;
		try {
		  body = await request.json();
		} catch {
		  return json(400, { error: "Invalid JSON body" });
		}
  
		const { amount, description, userId } = body || {};
		if (!amount || !userId) {
		  return json(400, {
			error: "Missing required fields: amount, userId",
		  });
		}
  
		// 👇 THIS is where that snippet goes
		// external_id ties the invoice to your Firebase user
		const externalId = `user_${userId}_${Date.now()}`;
  
		// Xendit will redirect here after successful payment
		const successRedirectUrl =
		  `https://mhrm.jpyseyersoled.workers.dev/xendit-success` +
		  `?external_id=${encodeURIComponent(externalId)}`;
  
		// Optional failure page
		const failureRedirectUrl =
		  `https://mhrm.jpyseyersoled.workers.dev/xendit-failed`;
  
		const xenditRes = await fetch("https://api.xendit.co/v2/invoices", {
		  method: "POST",
		  headers: {
			"Content-Type": "application/json",
			Authorization: "Basic " + btoa(`${XENDIT_SECRET_KEY}:`),
		  },
		  body: JSON.stringify({
			external_id: externalId,
			amount,
			description: description || "Receipt Manager Pro Plan",
			success_redirect_url: successRedirectUrl,
			failure_redirect_url: failureRedirectUrl,
		  }),
		});
  
		if (!xenditRes.ok) {
		  const errorBody = await xenditRes.text();
		  console.error("Xendit create error:", errorBody);
		  return json(500, {
			error: "Failed to create Xendit invoice",
			details: errorBody,
		  });
		}
  
		const data = await xenditRes.json();
  
		return json(200, {
		  invoice_url: data.invoice_url,
		  id: data.id,
		  status: data.status,
		});
	  }
  
	  // 2) Success redirect from Xendit
	  if (url.pathname === "/xendit-success") {
		const externalId = url.searchParams.get("external_id");
  
		if (!externalId) {
		  return html(
			400,
			"<h1>Missing external_id</h1><p>Cannot verify payment.</p>"
		  );
		}
  
		// external_id format: user_<uid>_<timestamp>
		const match = externalId.match(/^user_(.+)_\d+$/);
		const userId = match ? match[1] : null;
  
		if (!userId) {
		  console.error("Failed to parse userId from external_id:", externalId);
		  return html(
			400,
			"<h1>Invalid external_id</h1><p>Cannot determine user.</p>"
		  );
		}
  
		try {
		  // Get invoice by external_id from Xendit
		  const invRes = await fetch(
			`https://api.xendit.co/v2/invoices?external_id=${encodeURIComponent(
			  externalId
			)}`,
			{
			  method: "GET",
			  headers: {
				Authorization: "Basic " + btoa(`${XENDIT_SECRET_KEY}:`),
			  },
			}
		  );
  
		  if (!invRes.ok) {
			const txt = await invRes.text();
			console.error("Xendit fetch by external_id error:", txt);
			return html(
			  500,
			  "<h1>Payment processing issue</h1><p>We could not verify your payment yet.</p>"
			);
		  }
  
		  const invoices = await invRes.json();
		  const invoice = Array.isArray(invoices) ? invoices[0] : invoices;
  
		  const status = invoice?.status;
		  console.log("Invoice status on success redirect:", status);
  
		  if (status === "PAID") {
			// ✅ Update Firebase RTDB (rules are open, so no auth)
			const dbUrl = "https://mhrm-a0b26-default-rtdb.firebaseio.com"; // e.g. https://mhrm-a0b26-default-rtdb.asia-southeast1.firebasedatabase.app
  
			if (!dbUrl) {
			  console.error("FIREBASE_DB_URL missing in env");
			} else {
			  const firebaseRes = await fetch(
				`${dbUrl}/users/${encodeURIComponent(userId)}.json`,
				{
				  method: "PATCH",
				  headers: { "Content-Type": "application/json" },
				  body: JSON.stringify({ payment: true }),
				}
			  );
  
			  if (!firebaseRes.ok) {
				const fbTxt = await firebaseRes.text();
				console.error("Firebase update error:", fbTxt);
			  }
			}
  
			// Thank you page
			return html(
			  200,
			  `
				<h1>Payment successful 🎉</h1>
				<p>You can now close this tab and go back to the app.</p>
			  `
			);
		  }
  
		  // Not paid yet
		  return html(
			200,
			`
			  <h1>Payment pending</h1>
			  <p>We haven't confirmed your payment yet. If you've already paid, please wait a moment then reopen the app.</p>
			`
		  );
		} catch (err) {
		  console.error("xendit-success error:", err);
		  return html(
			500,
			"<h1>Unexpected error</h1><p>Something went wrong processing your payment.</p>"
		  );
		}
	  }
  
	  // 3) Optional failure page
	  if (url.pathname === "/xendit-failed") {
		return html(
		  200,
		  "<h1>Payment failed</h1><p>Your payment was not completed.</p>"
		);
	  }
  
	  // 4) Fallback
	  return json(404, { error: "Not found" });
	},
  };
  
  function json(status, body) {
	return new Response(JSON.stringify(body), {
	  status,
	  headers: {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	  },
	});
  }
  
  function html(status, body) {
	return new Response(
	  `<!DOCTYPE html>
	   <html><head><meta charset="utf-8"><title>Receipt Manager</title></head>
	   <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;">
		 ${body}
	   </body></html>`,
	  {
		status,
		headers: { "Content-Type": "text/html; charset=utf-8" },
	  }
	);
  }
  