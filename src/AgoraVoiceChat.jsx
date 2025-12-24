import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import {
  useLocalMicrophoneTrack,
  useJoin,
  usePublish,
  useRemoteUsers,
  useIsConnected,
  useRemoteAudioTracks
} from 'agora-rtc-react';

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || 'https://ivita.test').replace(/\/$/, '');
const API_PREFIX = (process.env.REACT_APP_API_PREFIX || '/agora-ai').replace(/\/?$/, '');
const USER_ACCESS_TOKEN = process.env.REACT_APP_USER_ACCESS_TOKEN || '';

const AgoraVoiceChat = ({ appId }) => {
  const isConnected = useIsConnected();
  const makeRtcUid = () => Math.floor(Math.random() * 65534) + 1; // 1..65535
  const normalizeRtcUid = (val) => {
    const n = Number(val);
    if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
    return makeRtcUid();
  };

  const [userId, setUserId] = useState(() => makeRtcUid());
  const [channelName, setChannelName] = useState('');
  const [agentId, setAgentId] = useState(null);
  const [rtcToken, setRtcToken] = useState(null);
  const [messages, setMessages] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);

  const { localMicrophoneTrack } = useLocalMicrophoneTrack(micEnabled);
  const remoteUsers = useRemoteUsers();
  const { audioTracks } = useRemoteAudioTracks(remoteUsers);

  const api = useMemo(() => {
    const instance = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Content-Type': 'application/json' }
    });

    instance.interceptors.request.use(config => {
      if (USER_ACCESS_TOKEN) {
        config.headers.Authorization = `Bearer ${USER_ACCESS_TOKEN}`;
      }
      return config;
    });
    return instance;
  }, []);

  const withPrefix = path => {
    if (!API_PREFIX) return path;
    const prefix = API_PREFIX.startsWith('/') ? API_PREFIX : `/${API_PREFIX}`;
    return `${prefix}${path}`;
  };

  const joinUid = normalizeRtcUid(userId);

  useEffect(() => {
    console.log('Remote users:', remoteUsers.map(u => ({ uid: u.uid, hasAudio: u.hasAudio })));
    console.log('Audio tracks:', audioTracks);
  }, [remoteUsers, audioTracks]);

  console.log(`Join UID [before useJoin hook]: ${joinUid}`);
  useJoin(
    {
      appid: appId,
      channel: channelName || '',
      token: rtcToken || null,
      uid: joinUid
    },
    Boolean(channelName && rtcToken)
  );

  usePublish(localMicrophoneTrack ? [localMicrophoneTrack] : []);

  useEffect(() => {
    audioTracks.forEach(track => {
      track.play();
    });
  }, [audioTracks]);

  const pushMessage = (payload) => {
    setMessages(prev => [
      ...prev,
      {
        ...payload,
        time: payload.time || new Date().toLocaleTimeString()
      }
    ]);
  };

  const toggleMic = async () => {
    if (localMicrophoneTrack) {
      await localMicrophoneTrack.setEnabled(!micEnabled);
      setMicEnabled(!micEnabled);
    }
  };

  const fetchRtcToken = async (incomingAgentId, incomingChannelName, incomingRtcUid) => {
    const safeUid = normalizeRtcUid(incomingRtcUid);
    const res = await api.get(withPrefix('/get-token'), {
      params: { rtc_uid: safeUid }
    });

    const token =
      res.data?.token ||
      res.data?.data?.token ||
      res.data?.result?.token ||
      null;

    const success = res.data?.success ?? res.data?.ok ?? true;

    if (!success || !token) {
      throw new Error(res.data?.error || 'API did not return an RTC token.');
    }

    const returnedUid = res.data?.rtc_uid ?? safeUid;
    const nextUid = normalizeRtcUid(returnedUid);
    setRtcToken(token);
    setChannelName(incomingChannelName || res.data?.channel_name || channelName);
    setUserId(nextUid);
    return token;
  };

  const handleStartAgent = async () => {
    try {
      setIsStarting(true);
      setMessages([]);
      setAgentId(null);
      setChannelName('');
      setRtcToken(null);

      const res = await api.get(withPrefix('/start-agent'));
      const payload = res.data || {};

      if (payload.success === false) {
        throw new Error(payload.error || 'start-agent failed');
      }

      const newAgentId = payload.agent_id;
      const newChannelName = payload.channel_name;
      const rtcUid = normalizeRtcUid(payload.rtc_uid ?? userId);
      const isNew = payload.is_new;

      if (!newAgentId || !newChannelName) {
        throw new Error('Missing agent_id or channel_name in API response.');
      }

      setAgentId(newAgentId);
      pushMessage({
        from: 'system',
        text: `Agent ${newAgentId} ${isNew ? 'created' : 'reused'} on channel ${newChannelName}`
      });

      await fetchRtcToken(newAgentId, newChannelName, rtcUid);
      await loadHistory(newAgentId);
    } catch (error) {
      console.error('Error starting agent:', error);
      pushMessage({ from: 'system', text: `Failed to start agent: ${error.message}` });
    } finally {
      setIsStarting(false);
    }
  };

  const loadHistory = async (id = null) => {
    const targetAgentId = id || agentId;
    if (!targetAgentId) return;

    try {
      const res = await api.post(withPrefix('/get-history'), { agent_id: targetAgentId });
      const success = res.data?.success ?? res.data?.ok ?? true;
      if (!success) {
        throw new Error(res.data?.error || 'get-history failed');
      }

      const history = res.data?.history || res.data?.data || [];
      const formatted = history.map(item => {
        if (typeof item === 'string') {
          return {
            from: 'ai',
            text: item,
            time: new Date().toLocaleTimeString()
          };
        }
        return {
          from: item.role === 'user' ? 'user' : 'ai',
          text: item.content || item.message || '',
          time: new Date(item.timestamp || Date.now()).toLocaleTimeString()
        };
      });

      if (formatted.length) {
        setMessages(prev => [...prev, ...formatted]);
      }
    } catch (error) {
      console.error('Unable to load history:', error);
      pushMessage({ from: 'system', text: `History failed: ${error.message}` });
    }
  };

  const handleSendVoice = async () => {
    if (!agentId || !textInput.trim()) return;
    const text = textInput.trim();
    setTextInput('');
    pushMessage({ from: 'user', text });

    try {
      setIsSending(true);
      const res = await api.post(withPrefix('/send-voice'), {
        agent_id: agentId,
        message: text
      });

      const success = res.data?.success ?? res.data?.ok ?? true;
      if (!success) {
        throw new Error(res.data?.error || 'send-voice failed');
      }

      pushMessage({
        from: 'system',
        text: 'AI is speaking this message in the voice channel…'
      });
    } catch (error) {
      console.error('Send voice failed:', error);
      pushMessage({ from: 'system', text: `Failed to send voice: ${error.message}` });
    } finally {
      setIsSending(false);
    }
  };

  const handleStopAgent = async () => {
    if (!agentId) return;
    try {
      await api.post(withPrefix('/stop-agent'), { agent_id: agentId });
    } catch (error) {
      console.error('stop agent error:', error);
    }

    pushMessage({ from: 'system', text: 'Agent stopped' });
    setAgentId(null);
    setChannelName('');
    setRtcToken(null);
  };

  return (
    <div className="voice-card">
      {!USER_ACCESS_TOKEN && (
        <div className="banner warn">
          REACT_APP_USER_ACCESS_TOKEN is not set. Requests will be rejected with 401.
        </div>
      )}

      <div className="panel">
        <div>
          <div className="label">Agent ID</div>
          <div className="value">{agentId || '—'}</div>
        </div>
        <div>
          <div className="label">Channel</div>
          <div className="value">{channelName || '—'}</div>
        </div>
        <div>
          <div className="label">RTC UID</div>
          <div className="value">{userId}</div>
        </div>
        <div>
          <div className="label">RTC</div>
          <div className={`pill ${isConnected ? 'pill-ok' : 'pill-warn'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      <div className="button-row">
        <button onClick={handleStartAgent} disabled={isStarting}>
          {isStarting ? 'Starting…' : 'Start / Reuse Agent'}
        </button>
        <button onClick={handleStopAgent} disabled={!agentId}>
          Stop Agent
        </button>
        <button onClick={() => loadHistory()} disabled={!agentId}>
          Refresh History
        </button>
        <button onClick={toggleMic} disabled={!channelName || !rtcToken}>
          Mic: {micEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="transcript">
        {messages.length === 0 && (
          <div className="muted">No messages yet. Start the agent and send something.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.from}`}>
            <div>{m.text}</div>
            <div className="timestamp">{m.time}</div>
          </div>
        ))}
      </div>

      <div className="composer">
        <input
          type="text"
          placeholder="Type text for the agent to speak…"
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendVoice()}
        />
        <button onClick={handleSendVoice} disabled={!agentId || !textInput.trim() || isSending}>
          {isSending ? 'Sending…' : 'Send Voice'}
        </button>
      </div>

      <div className="remote">
        <div className="label">Remote users (AI shows here when speaking)</div>
        {remoteUsers.length === 0 && <div className="muted">No remote users yet.</div>}
        {remoteUsers.map(user => (
          <div key={user.uid} className="remote-item">
            Remote UID: {String(user.uid)}
          </div>
        ))}
        {audioTracks.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="label">Remote audio tracks ({audioTracks.length})</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgoraVoiceChat;
