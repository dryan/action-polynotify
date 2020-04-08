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
    const slack = {
      webhook: core.getInput("slack_webhook_url").trim(),
    };
    const discord = {
      webhook: core.getInput("discord_webhook_url").trim(),
      username: core.getInput("discord_username").trim(),
      avatar: core.getInput("discord_avatar").trim(),
    };

    const message = core.getInput("message").trim();
    const color = core.getInput("color").trim();

    const failOnError = !!core.getInput("fail_on_error");

    if (Object.values(twilio).some((val) => !!val)) {
      if (Object.values(twilio).every((val) => !!val)) {
        let twilioResponses = [];
        await asyncForEach(twilio.toNumbers, async (toNumber) => {
          let twilioResponse = await axios.post(
            `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages`,
            qs.stringify({
              Body: [message, "", referenceLink].join("\n"),
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
        core.setOutput("twilio_result", twilioResponses);
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
    if (slack.webhook) {
      let slackPayload = {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: referenceLink,
              },
            ],
          },
        ],
      };
      if (color) {
        // we need to use attachments for colors
        slackPayload = {
          attachments: [
            {
              blocks: slackPayload.blocks,
              color: color,
            },
          ],
        };
      } else {
        // this is the preview text for notifications
        slackPayload.text = message;
      }
      let slackResponse = await axios.post(slack.webhook, slackPayload);
      core.setOutput("slack_result", slackResponse.data);
    }
    if (discord.webhook) {
      let discordPayload = {
        username: discord.username,
        avatar: discord.avatar,
        content: [message, "", referenceLink].join("\n"),
      };
      if (color) {
        discordPayload.content = "";
        discordPayload.embeds = [
          {
            title: [message, "", referenceLink].join("\n"),
            color: parseInt(color.replace(/^#/, ""), 16),
          },
        ];
      }
      let discordResponse = await axios.post(discord.webhook, discordPayload);
      core.setOutput("discord_result", discordResponse);
    }
  } catch (error) {
    if (failOnError) {
      core.setFailed(error.message);
    }
    console.error(error);
  }
};

run();
