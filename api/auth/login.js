exports.handler = async (event) => {
  try {
    const { username, password } = JSON.parse(event.body || "{}");
    if (!username || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing credentials" }) };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ user: username, token: "demo-token" })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
