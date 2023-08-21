# Team Digester

This is the repository for the Team Digester Slack/Github app. It allows teams to stay up to date on what everyone on the team is doing by integrating with Github. Messages are sent via Slack on a periodic basis, which is determined by each individual user. The application uses OpenAI's API to generate a summary of each team member's activity.

## How it's built

The application is built on Firebase using Typescript. It leverages Firebase's Cloud Functions to create four separate "applications" that handle four different tasks:
1. Slack app: this application is a Slack Bolt app that handles all of the needs of the Slack integration, including OAuth, interactivity, and webhook events.
1. Webhooks app: this application handles all of the incoming webhooks from all other sources besides Slack. Right now, that's just Github, but the idea would be to house all of the other webhooks here.
1. API app: this application handles other things that aren't covered in the Slack and Webhooks apps. That consists of Github OAuth callbacks right now, but could be expanded to other things in the future.
1. Notifications/Jobs: this application handles the processing and sending of notifications to users. It is run as an hourly cron job.

## How to use it

You will need to set up a few different things to get this running yourself. The first thing you'll have to do is create a Firebase app. You can do that by going to [Firebase Console](https://console.firebase.google.com/) and clicking "Add Project". For more instructions on how to get a Firebase app setup, check out [the docs](https://firebase.google.com/docs). 

Next, the application uses a Postgres database. The recommended service to use for this is [Neon](https://neon.tech/). Follow their guides on how to set up a database.

In addition to a Postgres database, the application also uses Redis. The recommended service to use for this is [Upstash](https://upstash.com/). Follow their guides on how to set up a Redis database.

Enter all of the required information from your database and redis instance into a `.env` file. You can use `.example.env` as a template. This file needs to be within the `functions` directory to be picked up by Firebase. You'll also have to enter your OpenAI API key into this file.

To deploy, first run `firebase deploy`. This should take you through a series of prompts to set up your Firebase app. Once that's done, you can deploy the functions by running `firebase deploy --only functions`. Once the functions have been deployed, note the api app's url and enter that into your `.env` file. You'll have to redeploy after you've done this.

Next, you'll have to set up the Slack app. Go to [Slack's API page](https://api.slack.com/apps) and create a new app. Once you've created the app, enter all the details into your `.env` file. You'll have to redeploy your functions after you've done this.

Finally, you'll have to set up a Github app. Go to [Github's developer page](https://developer.github.com/apps/building-github-apps/creating-a-github-app/) and create a new app. Once you've created the app, enter all the details into your `.env` file. You'll have to redeploy your functions after you've done this.

The last thing you'll need to do is run a migration on your database so that the tables are created. Navigate into the `functions` directory `cd functions` and run `npx prisma migrate deploy`. This will run a migration on the database you specified in your `.env` file.

Once you've done all the above, you should be good to go. You can then install the application to your Slack workspace by going to `https://<your-firebase-slack-app-url>/slack/install`. This will take you through the OAuth flow. Do this flow, even if you installed your Slack app from Slack's developer page. This will ensure that everything is installed correctly.

## Future improvements

This app is very basic and simple right now and likely contains some shortcomings. Here are some of the things that would be good to add in the future:
- The ability to handle responses and messages from users. Using OpenAI's API, it should receive a user's message, give the AI functions to choose from to help get answers, and then finally respond back to users
- Better handle too large of updates. Right now, the app does not do any sort of handling of content that might be too large for the models, it just fails. It would be better to chunk out the activities and updates into smaller messages, summarize those, and then summarize those summaries. This is likely the only way to handle repos with lots of activity.
- Update it so if there is no activity for a specific team member or the entire team it says that rather than hallucinating 
