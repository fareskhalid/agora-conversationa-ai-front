import './App.css';
import AgoraVoiceChat from './AgoraVoiceChat';
import AgoraConversationalAI from './AgoraConversationalAI';

const DEFAULT_APP_ID = 'YOUR_APP_ID';
const envAppId = process.env.REACT_APP_AGORA_APP_ID;
const appId = envAppId || DEFAULT_APP_ID;

function App() {
  const isUsingFallbackAppId = !envAppId;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Agora Conversational AI Demo</p>
          <h1>Voice agent playground</h1>
          <p className="lede">
            Start an Agora agent, join its RTC channel, send it messages, and
            review conversation history via the provided IVITA API endpoints.
          </p>
        </div>
        <div className="env-badge">
          <div className="label">App ID</div>
          <div className="value">{appId}</div>
          {isUsingFallbackAppId && (
            <div className="hint">
              Using fallback ID. Set <code>REACT_APP_AGORA_APP_ID</code> to your
              own value.
            </div>
          )}
        </div>
      </header>

      <main>
        <AgoraConversationalAI appId={appId} />
      </main>
    </div>
  );
}

export default App;
