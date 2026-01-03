module.exports.config = {
  url: process.env.URL || "https://uniaxially-nonphonetic-kelsey.ngrok-free.dev",
  port: process.env.NODE_PORT || 8080,
  ngrok_auth_token: process.env.NGROK_AUTH_TOKEN || "",
  manifestName: 'manifest-v0.1.json'
}
