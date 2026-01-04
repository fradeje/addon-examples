const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());
app.use(express.static("static"));

const { registerInvoicePdfEndpoint } = require("./endpoints/invoicePdf");
registerInvoicePdfEndpoint(app);

const { registerVendorProfileEndpoint } = require("./endpoints/vendorProfile");
registerVendorProfileEndpoint(app);

module.exports.app = app;