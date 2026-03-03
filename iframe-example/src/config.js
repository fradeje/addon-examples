module.exports.config = {
  url: process.env.PUBLIC_BASE_URL || "http://localhost:8080",
  port: Number(process.env.PORT || process.env.NODE_PORT || 8080),
  ngrok_auth_token: process.env.NGROK_AUTH_TOKEN || "",
  manifestName: "manifest-v0.1.json",
};