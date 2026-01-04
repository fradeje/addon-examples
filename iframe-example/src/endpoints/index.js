require("./manifest");
const { registerVendorProfileEndpoint } = require("./vendorProfile");
module.exports = (app) => {
  registerVendorProfileEndpoint(app);
};