export interface Env {
	XENDIT_SECRET_KEY: string;
  }
  
  function jsonResponse(
	status: number,
	body: unknown,
	extraHeaders: Record<string, string> = {}
  ): Response {
	return new Response(JSON.stringify(body), {
	  status,
	  headers: {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		...extraHeaders,
	  },
	});
  }
  
  export default {
	async fetch(request: Request, env: Env): Promise<Response> {
	  const url = new URL(request.url);
  
	  // Only handle this specific route
	  if (url.pathname !== "/create-xendit-invoice") {
		return jsonResponse(404, { error: "Not found" });
	  }
  
	  // Handle CORS preflight
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
  
	  if (request.method !== "POST") {
		return jsonResponse(405, { error: "Method not allowed" });
	  }
  
	  const XENDIT_SECRET_KEY = env.XENDIT_SECRET_KEY;
	  if (!XENDIT_SECRET_KEY) {
		console.error("Xendit secret key missing in environment");
		return jsonResponse(500, { error: "Xendit secret key not configured" });
	  }
  
	  try {
		const body = (await request.json()) as {
		  amount?: number;
		  description?: string;
		  userId?: string;
		};
  
		const { amount, description, userId } = body;
  
		if (!amount || !userId) {
		  return jsonResponse(400, {
			error: "Missing required fields: amount, userId",
		  });
		}
  
		const externalId = `user_${userId}_${Date.now()}`;
  
		// Call Xendit
		const xenditResponse = await fetch("https://api.xendit.co/v2/invoices", {
		  method: "POST",
		  headers: {
			"Content-Type": "application/json",
			Authorization:
			  "Basic " + btoa(`${XENDIT_SECRET_KEY}:`), // username:password (password empty)
		  },
		  body: JSON.stringify({
			external_id: externalId,
			amount,
			description: description || "Receipt Manager Pro Plan",
			success_redirect_url:
			  "https://your-app-domain.com/payment-success",
			failure_redirect_url:
			  "https://your-app-domain.com/payment-failed",
		  }),
		});
  
		if (!xenditResponse.ok) {
		  const errorBody = await xenditResponse.text();
		  console.error("Xendit error response:", errorBody);
		  return jsonResponse(500, {
			error: "Failed to create Xendit invoice",
			details: errorBody,
		  });
		}
  
		const data = await xenditResponse.json();
  
		return jsonResponse(200, {
		  invoice_url: data.invoice_url,
		  id: data.id,
		  status: data.status,
		});
	  } catch (err: any) {
		console.error("Xendit error:", err?.stack || err?.message || err);
		return jsonResponse(500, {
		  error: "Failed to create Xendit invoice",
		  details: err?.message || String(err),
		});
	  }
	},
  } satisfies ExportedHandler<Env>;
  