// Netlify Function: Proxy to Metabase API
// Environment variable required: METABASE_API_KEY

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const METABASE_BASE_URL = process.env.METABASE_BASE_URL || "https://metabase.livocompany.com";
  const METABASE_API_KEY = process.env.METABASE_API_KEY;

  if (!METABASE_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "METABASE_API_KEY not configured" }),
    };
  }

  // Question ID from query param or default to 9377
  const questionId = event.queryStringParameters?.question || "9377";

  try {
    const response = await fetch(
      `${METABASE_BASE_URL}/api/card/${questionId}/query/json`,
      {
        method: "POST",
        headers: {
          "x-api-key": METABASE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: `Metabase API error: ${response.status}`,
          detail: errorText,
        }),
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        data,
        meta: {
          question_id: questionId,
          row_count: data.length,
          fetched_at: new Date().toISOString(),
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
