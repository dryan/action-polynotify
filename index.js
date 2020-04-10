const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios");
const qs = require("qs");
const { WebClient: SlackWebClient } = require("@slack/web-api");

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

// from https://github.com/voxmedia/github-action-slack-notify-build/blob/master/src/utils.js#L54
const formatSlackChannelName = (channel) => {
  return channel.replace(/[#@]/g, "");
};

const getSlackChannelId = async (client, channelName) => {
  let channelId;
  channelName = formatSlackChannelName(channelName);

  for await (const page of client.paginate("conversations.list", {
    types: "public_channel, private_channel",
  })) {
    const channel = page.channels.find((c) => c.name === channelName);
    if (channel) {
      channelId = channel.id;
      break;
    }
  }

  return channelId;
};

let failOnError = false;

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
    const referenceLinkLabel =
      event === "pull_request"
        ? payload.pull_request.title
        : `"${payload.head_commit.message}" on ${branch}`;
    const twilio = {
      accountSid: core.getInput("twilio_account_sid"),
      apiKeySid: core.getInput("twilio_api_key_sid"),
      apiKeySecret: core.getInput("twilio_api_key_secret"),
      fromNumber: core.getInput("twilio_from_number"),
      toNumbers: arrayOrNull(
        core
          .getInput("twilio_to_numbers")
          .split(",")
          .map((num) => num.trim())
          .filter((num) => !!num)
      ),
    };
    const slack = {
      webhook: core.getInput("slack_webhook_url"),
      token: core.getInput("slack_bot_token"),
      channelName: core.getInput("slack_channel_name"),
      messageId: core.getInput("slack_message_id"),
      icon: core.getInput("slack_icon_url"),
      username: core.getInput("slack_username"),
    };
    const discord = {
      webhook: core.getInput("discord_webhook_url"),
      username: core.getInput("discord_username"),
      avatar: core.getInput("discord_avatar"),
    };

    const message = core.getInput("message");
    const color = core.getInput("color");

    failOnError = core.getInput("fail_on_error");

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

    if (slack.token) {
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
                text: `<https://github.com/${owner}/${repo}/commit/${sha}/checks | ${workflow}>`,
              },
              {
                type: "mrkdwn",
                text: `<${referenceLink} | ${referenceLinkLabel}>`,
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
              fallback: message,
              text: message,
              footer: `<https://github.com/${owner}/${repo}/commit/${sha}/checks | ${workflow}> | <${referenceLink} | ${referenceLinkLabel}>`,
              footer_icon: "https://github.githubassets.com/favicon.ico",
              color: color,
            },
          ],
        };
      } else {
        // this is the preview text for notifications
        slackPayload.text = message;
      }
      if (slack.username) {
        slackPayload.as_user = false;
        slackPayload.username = slack.username;
        if (slack.icon) {
          slackPayload.icon_url = slack.icon;
        }
      }
      const slackClient = new SlackWebClient(slack.token);
      slack.channelId = await getSlackChannelId(slackClient, slack.channelName);
      if (slack.channelId) {
        const slackApiMethod = Boolean(slack.messageId)
          ? "update"
          : "postMessage";
        slackPayload.channel = slack.channelId;
        if (slack.messageId) {
          slackPayload.ts = slack.messageId;
        }
        const slackResponse = await slackClient.chat[slackApiMethod](
          slackPayload
        );
        core.setOutput("slack_message_id", slackResponse.ts);
      } else {
        console.error(`Slack channel ${slack.channelName} not found.`);
        if (failOnError) {
          core.setFailed(`Slack channel ${slack.channelName} not found.`);
        }
      }
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
