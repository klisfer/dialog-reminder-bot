const dotenv = require("dotenv");
const Bot = require("@dlghq/dialog-bot-sdk");
const Rpc = require("@dlghq/dialog-bot-sdk");
const {
  MessageAttachment,
  ActionGroup,
  Action,
  Button,
  Select,
  SelectOption
} = require("@dlghq/dialog-bot-sdk");
const { flatMap } = require("rxjs/operators");
const { merge } = require("rxjs");
const moment = require("moment");
let _ = require("lodash");
let timeOptions = require("./timeOptions");

let currentReminder = "";
let activeUsers = [];
let specifiedTime = { hour: null, min: null };

dotenv.config();
const buttonOptions = [
  { type: "button", id: "30 mins", label: "In 30 minutes" },
  { type: "button", id: "1 hour", label: "In an hour" },
  { type: "button", id: "2 hours", label: "In 2 hours" },
  { type: "button", id: "tomorrow", label: "Tomorrow" },
  { type: "button", id: "1 week", label: "A week Later" },
  { type: "button", id: "selectTime", label: "Specify Time" }
];
const selectOptionsTime = [
  {
    type: "select",
    id: "Hour",
    label: "Hour",
    options: timeOptions.time.hours
  },
  {
    type: "select",
    id: "Minutes",
    label: "Mins",
    options: timeOptions.time.minutes
  }
];

//token to connect to the bot
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint =
  process.env.BOT_ENDPOINT || "https://grpc-test.transmit.im:9443";

// async function run(token, endpoint) {
const bot = new Bot.default({
  token,
  endpoints: [endpoint]
});

//fetching bot name
const self = bot
  .getSelf()
  .then(response => {
    console.log(`I've started, post me something @${response.nick}`);
  })
  .catch(err => console.log(err));

bot.updateSubject.subscribe({
  next(update) {
    console.log(JSON.stringify({ update }, null, 2));
  }
});

bot.ready.then(async (response) => {
  //mapping the current user
  await response.dialogs.forEach(peer => {
    console.log("PEER" , peer);
    if (peer.type === "private") {
        getCurrentUser(bot, peer).then(user => {
          sendFirstMessage(user.peer);
        });
    }
  });
});


/*  -----


subscribing to incoming messages


------ */

const messagesHandle = bot.subscribeToMessages().pipe(
  flatMap(async message => {
    currentReminder = message.content.text;
    const text = "Ok! When do you need me to remind you of this?";
    sendTextMessage(text, message.peer, buttonOptions);
  })
);

//creating action handle
const actionsHandle = bot.subscribeToActions().pipe(
  flatMap(async event => {
    let peer = new Peer(event.uid);
    if (event.id === "Hour") {
      specifiedTime.hour = event.value;
      console.log("specified" ,specifiedTime)
      if (specifiedTime.min !== null && specifiedTime.hour !== null)
        scheduleCustomReminder(specifiedTime.hour, specifiedTime.min);
    } else if (event.id === "Minutes") {
      specifiedTime.min = event.value;
      console.log("specified" ,specifiedTime)
      if (specifiedTime.min !== null && specifiedTime.hour !== null)
        scheduleCustomReminder(specifiedTime.hour, specifiedTime.min , peer);
    } else if (event.id === "30 mins") {
      scheduleReminder(30 , peer);
    } else if (event.id === "1 hour") {
      scheduleReminder(60 , peer);
    } else if (event.id === "2 hours") {
      scheduleReminder(120 , peer);
    } else if (event.id === "tomorrow") {
      scheduleReminder(60 * 24, peer);
    } else if (event.id === "1 week") {
      scheduleReminder(60 * 24 * 7 , peer);
    } else if (event.id === "selectTime") {
      sendTextMessage("Choose Time", peer , selectOptionsTime);
    }
  })
);

// merging actionHandle with messageHandle
new Promise((resolve, reject) => {
  merge(messagesHandle, actionsHandle).subscribe({
    error: reject,
    complete: resolve
  });
})
  .then(response => console.log(response))
  .catch(err => console.log(err));

/* -------

action handle functions

------ */
function scheduleReminder(time , peer) {
  const timeLeft = time * 60000; //milliseconds
  const reminderText =
    "Hey! you asked to remind " + '"' + currentReminder + '"';
  setTimeout(function() {
    sendTextMessage(reminderText ,peer);
  }, timeLeft);
  const successResponse = "Your mentions have been scheduled";

  sendTextMessage(successResponse ,peer);
}

function scheduleCustomReminder(hour, min , peer) {
  const time = hour + ":" + min;
  const scheduledTime = moment(time, "HH:mm").format("HH:mm");
  const now = moment(Date.now()).format("HH:mm");
  const timeLeft = moment(scheduledTime, "HH:mm").diff(moment(now, "HH:mm"));

  if (timeLeft < 0) {
    sendTextMessage("Selected time has passed, try again" , peer);
    specifiedTime.hour = null;
    specifiedTime.min = null;
  } else {
    const reminderText =
      "Hey! you asked to remind " + '"' + currentReminder + '"';
    setTimeout(function() {
      sendTextMessage(reminderText , peer );
    }, timeLeft);

    const successResponse = "Your mentions have been scheduled";

    sendTextMessage(successResponse , peer);
    specifiedTime.hour = null;
    specifiedTime.min = null;
  }
}

/* -------

message handle functions

------ */
async function getCurrentUser(bot, peer) {
  const current_user = await bot.getUser(peer.id);
  let user = new User(current_user.name , peer);
  activeUsers.push(user);
  
  return user;
}

//general functions
function selectOptionFormat(options) {
  var selectOptions = [];
  options.map(option => {
    selectOptions.push(new SelectOption(option.label, option.value));
  });

  return selectOptions;
}

//actionOptions is an array of format [{type:"", id: "", label: "", options: ""}]
function actionFormat(actionOptions) {
  var actions = [];
  actionOptions.map(options => {
    if (options.type === "select") {
      const selectOptions = selectOptionFormat(options.options);

      var action = Action.create({
        id: options.id,
        widget: Select.create({
          label: options.label,
          options: selectOptions
        })
      });

      actions.push(action);
    } else if (options.type === "button") {
      var action = Action.create({
        id: options.id,
        widget: Button.create({ label: options.label })
      });

      actions.push(action);
    }
  });

  return actions;
}

//actions is an array of format [{type:"" , id: "" , label: "" , options: ""}]
function sendTextMessage(text, peer, actions) {
  var messageToSend = messageformat(text , peer);
  var action = actions || null;
  var actionGroup = null;
  if (action !== null) {
    actionGroup = ActionGroup.create({
      actions: actionFormat(action)
    });
  }
  sendTextToBot(bot, messageToSend, actionGroup);
}

function messageformat(text , peer) {
  var message = { peer: peer, text: text };
  return message;
}

function sendTextToBot(bot, message, actionGroup) {
  var actionGroups = actionGroup || null;
  bot
    .sendText(
      message.peer,
      message.text,
      MessageAttachment.reply(null),
      actionGroups
    )
    .then(response => console.log(response))
    .catch(err => console.log("err", err));
}


function User(name , peer){
  this.name = name;
  this.peer = peer;
}

function Peer(id){
  this.id = id;
  this.type = "private";
  this.strId = null; 
}


function sendFirstMessage(peer){
  const text ="Hi! You can send me a message and I will remind you about it at the right time.";
  sendTextMessage(text , peer);
}