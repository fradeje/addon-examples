const clc = require("cli-color");
const { config } = require("./config");

module.exports.printServerInfo = () => {
  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME;

  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL ||
    (renderHost ? `https://${renderHost}` : config.url);

  const manifestPublicUrl = `${publicBaseUrl.replace(/\/+$/, "")}/${config.manifestName}`;

  console.log("\n\n");
  console.log(clc.magenta("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"));
  console.log("\n");
  console.log(clc.blue("Manifest is running on:"), clc.green(manifestPublicUrl), "\n");
  console.log(
    clc.blue(
      "You can add it to your Clockify test instance, available from the \nDeveloper Portal at:"
    ),
    clc.green("https://developer.marketplace.cake.com/")
  );
  console.log("\n");
  console.log(clc.magenta("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"));
  console.log("\n");
};