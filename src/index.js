// import React from 'react';
// import ReactDOM from 'react-dom/client';
// import './index.css';
// import App from './App';
// import reportWebVitals from './reportWebVitals';
// import { AgoraRTCProvider } from 'agora-rtc-react';
// import AgoraRTC from 'agora-rtc-sdk-ng';

// const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// ReactDOM.createRoot(document.getElementById('root')).render(
//   <AgoraRTCProvider client={client}>
//     <App />
//   </AgoraRTCProvider>
// );

// // If you want to start measuring performance in your app, pass a function
// // to log results (for example: reportWebVitals(console.log))
// // or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Remove these imports and the Provider
// import { AgoraRTCProvider } from 'agora-rtc-react';
// import AgoraRTC from 'agora-rtc-sdk-ng';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();