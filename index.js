// index file of the project

const dotenv = require('dotenv')
dotenv.config()
var request = require('request');
var funcs=require('./intentFunctions')

const { WebClient } = require('@slack/web-api');
const token = process.env.BOT_TOKEN;
const web = new WebClient(token);

const { createEventAdapter } = require('@slack/events-api');
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);

const express = require("express");
const app = express();
const bodyParserPackage = require('body-parser')

app.listen(3000, () => console.log("Server listening on port 3000!"));

app.use(bodyParserPackage.json());

/*
app.use(bodyParserPackage.json({ limit: '10mb' })); // parse application/json and set limit as 10 MB
app.use(bodyParserPackage.json({ 'Content-type': 'application/json' })); // parse application/vnd.api+json as json
app.use(bodyParserPackage.urlencoded({ limit: '10mb', extended: true })); // parse application/x-www-form-urlencoded
*/


// Processes the incoming dialogflow webhook requests. The source of this incoming request is the slack app.
app.use('/webhook/', function (req, res) {
    const { WebhookClient } = require('dialogflow-fulfillment');
        const agent = new WebhookClient({request: req, response: res});

    var intent=req.body.queryResult.intent.displayName
    var event=req.body.originalDetectIntentRequest.payload.data.event
    debugger;
     if (intent==='leave') {
       console.log("Intent Found ! directing to leave ... ");
        const result = web.chat.postMessage({
            text: "Finding out...",
            channel: event.user
         });
        funcs.timeoff(event)
      }

     else if (intent==='HRBP') {
       console.log("Intent Found ! directing to HRBP ... ");
        funcs.myhr(event)
     }

     else if (intent==='public holiday') {
        console.log("Intent Found ! directing to public holiday ... ");
        funcs.holiday(event)
     }

     else if (intent==='optionalCount') {
       console.log("Intent Found ! directing to optionalCount ... ");
         funcs.opt_balance(event)
     }

     else if (intent==='my_interviews') {
       console.log("Intent Found ! directing to my_interviews ... ");
         funcs.interviews(event)
     }
   })
