# Agora Conversational AI front-end

React UI for starting/stopping an Agora Conversational AI agent, sending it
voice messages, and joining the agent’s RTC channel. The app is wired to the
IVITA API endpoints listed in the task description.

## Environment variables

Create a `.env` file (or export values) before running the app:

```
REACT_APP_AGORA_APP_ID=<your-agora-app-id>
REACT_APP_API_BASE_URL=https://ivita.apidog.io
REACT_APP_API_PREFIX=/agora-ai
REACT_APP_USER_ACCESS_TOKEN=<user bearer token for the IVITA API>
```

`REACT_APP_API_PREFIX` lets you adjust the path segment if your backend hosts
the endpoints somewhere other than `/agora-ai`.

## Running locally

```
npm install
npm start
```

The app runs at http://localhost:3000.

---

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app), so the original CRA instructions are kept below.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.
