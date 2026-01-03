const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());
app.use(express.static("static"));

const { registerInvoicePdfEndpoint } = require("./endpoints/invoicePdf");
registerInvoicePdfEndpoint(app);

module.exports.app = app;
