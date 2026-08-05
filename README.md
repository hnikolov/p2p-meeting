# 2-Person Serverless Meeting Application
[Simple Video Call Application](https://hnikolov.github.io/p2p-meeting)

# Notes
Using firebase db:
https://console.firebase.google.com/project/p2p-meeting-c4e09/overview

# Set Up a Free Firebase Database
Because GitHub Pages cannot run a backend, Firebase will act as a temporary mailbox to swap connection tokens.
- Go to the Firebase Console.
- Click Add project, name it (e.g., p2p-meeting), and disable Google Analytics.
- Click the Web icon (</>) to register a web app. Name it and click Register app.
- Copy the firebaseConfig object from the code snippet shown (you will paste this into your HTML file).
- In the left sidebar, click Build > Realtime Database, then click Create Database.
- Choose a location closest to you and click Next.
- Start in test mode (so you and your friend can read/write without complex authentication) and click Enable.
