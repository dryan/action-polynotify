const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios");
const qs = require("qs");

const asyncForEach = async (array, callback) => {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
};

const arrayOrNull = (arr) => {
  if (arr.length) {
    return arr;
  }
  return null;
};

const toTitleCase = (str) =>
  str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });

let run = async () => {
  try {
    const { payload, ref, workflow, eventName } = github.context;
    const { owner, repo } = github.context.repo;
    const { pull_request: pr } = payload;
    const event = eventName;
    const branch =
      event === "pull_request"
        ? payload.pull_request.head.ref
        : ref.replace("refs/heads/", "");
    const sha =
      event === "pull_request"
        ? payload.pull_request.head.sha
        : github.context.sha;
    const referenceLink =
      event === "pull_request"
        ? payload.pull_request.html_url
        : `https://github.com/${owner}/${repo}/commit/${sha}`;

    const twilio = {
      accountSid: core.getInput("twilio_account_sid").trim(),
      apiKeySid: core.getInput("twilio_api_key_sid").trim(),
      apiKeySecret: core.getInput("twilio_api_key_secret").trim(),
      fromNumber: core.getInput("twilio_from_number").trim(),
      toNumbers: arrayOrNull(
        core
          .getInput("twilio_to_numbers")
          .split(",")
          .map((num) => num.trim())
      ),
    };
    const slackWebhook = core.getInput("slack_webhook_url").trim();
    const discordWebhook = core.getInput("discord_webhook_url").trim();

    let message = core.getInput("message").trim();
    console.log(twilio);
    if (Object.values(twilio).some((val) => !!val)) {
      if (Object.values(twilio).every((val) => !!val)) {
        let twilioResponses = [];
        await asyncForEach(twilio.toNumbers, async (toNumber) => {
          let twilioResponse = await axios.post(
            `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages`,
            qs.stringify({
              Body: [message, referenceLink].join("\n"),
              From: twilio.fromNumber,
              To: toNumber,
            }),
            {
              auth: {
                username: twilio.apiKeySid,
                password: twilio.apiKeySecret,
              },
              headers: { "content-type": "application/x-www-form-urlencoded" },
            }
          );
          twilioResponses.push(twilioResponse);
        });
      } else {
        let missing = Object.entries(twilio)
          .filter((entry) => !!entry[1])
          .map(
            (entry) =>
              `twilio_${entry[0]
                .replace(/\.?([A-Z]+)/g, function (x, y) {
                  return "_" + y.toLowerCase();
                })
                .replace(/^_/, "")}`
          );
        console.warn(
          `Twilio argument${missing.length === 1 ? "" : "s"} ${missing.join(
            ", "
          )} missing.`
        );
      }
    }
    if (slackWebhook) {
    }
  } catch (error) {
    core.setFailed(error.message);
    console.error(error);
  }
};

run();
