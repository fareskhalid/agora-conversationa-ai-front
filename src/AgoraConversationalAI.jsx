import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import AgoraRTC from 'agora-rtc-sdk-ng';

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || 'https://ivita.test').replace(/\/$/, '');
const API_PREFIX = (process.env.REACT_APP_API_PREFIX || '/agora-ai').replace(/\/?$/, '');
const USER_ACCESS_TOKEN = process.env.REACT_APP_USER_ACCESS_TOKEN || '';

const AgoraConversationalAI = ({ appId }) => {
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
  const [isConnected, setIsConnected] = useState(false);

  const [localMicrophoneTrack, setLocalMicrophoneTrack] = useState(null);

  // Manual remote tracking
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);

  const client = useMemo(() => {
    //  autoSubscribeAudio: true
    return AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8', audioScenario: 'AI_CLIENT', autoSubscribeAudio: true });
  }, []);

  // Create local microphone track manually
  useEffect(() => {
    if (!micEnabled) {
      if (localMicrophoneTrack) {
        localMicrophoneTrack.close();
        setLocalMicrophoneTrack(null);
      }
      return;
    }

    let track;
    AgoraRTC.createMicrophoneAudioTrack()
      .then(createdTrack => {
        track = createdTrack;
        setLocalMicrophoneTrack(track);
        console.log('Local microphone track created');
      })
      .catch(err => {
        console.error('Failed to create microphone track:', err);
        pushMessage({ from: 'system', text: `Mic error: ${err.message}` });
      });

    return () => {
      if (track) {
        track.close();
      }
    };
  }, [micEnabled]);

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

  // Debug logs
  useEffect(() => {
    console.log('Remote users:', remoteUsers.map(u => ({ uid: u.uid, hasAudio: u.hasAudio })));
    console.log('Audio tracks:', audioTracks);
  }, [remoteUsers, audioTracks]);

  console.log(`Join UID: ${joinUid}`);

  // Join channel when token & channel are ready
  useEffect(() => {
    if (!channelName || !rtcToken) return;

    const join = async () => {
      try {
        await client.join(appId, channelName, rtcToken, joinUid);
        setIsConnected(true);
        console.log('Joined channel successfully');
      } catch (err) {
        console.error('Join failed:', err);
      }
    };

    join();
  }, [channelName, rtcToken, client, appId, joinUid]);

  // Publish local mic when connected and track ready
  useEffect(() => {
    if (!isConnected || !localMicrophoneTrack) {
      return;
    }

    // Extra safety: ensure it's a real ILocalTrack instance
    if (typeof localMicrophoneTrack.getTrackId !== 'function') {
      console.warn('Invalid local track object');
      return;
    }

    const publish = async () => {
      try {
        await client.publish([localMicrophoneTrack]);
        console.log('Microphone published successfully');
      } catch (err) {
        console.error('Publish failed:', err);
      }
    };

    publish();

    // Cleanup: unpublish when track changes or component unmounts
    return () => {
      client.unpublish([localMicrophoneTrack]).catch(() => {});
    };
  }, [isConnected, localMicrophoneTrack, client]);

  // Handle remote users publishing/unpublishing audio
  useEffect(() => {
    const handleUserPublished = async (user, mediaType) => {
      if (mediaType === 'audio') {
        try {
          await client.subscribe(user, mediaType);
          if (user.audioTrack) {
            user.audioTrack.play();
            setAudioTracks(prev => [...prev, user.audioTrack]);
          }
          setRemoteUsers(prev => {
            if (prev.some(u => u.uid === user.uid)) return prev;
            return [...prev, user];
          });
        } catch (err) {
          console.error('Subscribe failed:', err);
        }
      }
    };

    const handleUserUnpublished = (user, mediaType) => {
      if (mediaType === 'audio') {
        setRemoteUsers(prev => prev.filter(u => u.uid !== user.uid));
        if (user.audioTrack) {
          setAudioTracks(prev => prev.filter(t => t !== user.audioTrack));
        }
      }
    };
    // Poll and play remote audio tracks (for AI agent streams)

    const handleUserJoined = (user) => {
      console.log('Remote user joined:', user.uid);
      setRemoteUsers(prev => {
        if (prev.some(u => u.uid === user.uid)) return prev;
        return [...prev, user];
      });
    };

    const handleUserLeft = (user) => {
      console.log('Remote user left:', user.uid);
      setRemoteUsers(prev => prev.filter(u => u.uid !== user.uid));
      if (user.audioTrack) {
        setAudioTracks(prev => prev.filter(t => t !== user.audioTrack));
      }
    };

    client.on('user-published', handleUserPublished);
    client.on('user-unpublished', handleUserUnpublished);
    client.on('user-joined', handleUserJoined);
    client.on('user-left', handleUserLeft);

    return () => {
      client.off('user-published', handleUserPublished);
      client.off('user-unpublished', handleUserUnpublished);
      client.off('user-joined', handleUserJoined);
      client.off('user-left', handleUserLeft);
    };
  }, [client]);

  // Poll remote users for audio tracks and play them (required for Conversational AI on Web)
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      client.remoteUsers.forEach(user => {
        // Update remote users list
        setRemoteUsers(prev => {
          if (prev.some(u => u.uid === user.uid)) return prev;
          return [...prev, user];
        });

        // If user has audio track, play it
        if (user.hasAudio && user.audioTrack) {
          if (!audioTracks.includes(user.audioTrack)) {
            user.audioTrack.play();
            console.log('Playing AI audio track from UID:', user.uid);
            setAudioTracks(prev => [...prev, user.audioTrack]);
          }
        }
      });
    }, 500); // Poll every 500ms

    return () => clearInterval(interval);
  }, [isConnected, client, audioTracks]);

  const pushMessage = (payload) => {
    setMessages(prev => [
      ...prev,
      {
        ...payload,
        time: payload.time || new Date().toLocaleTimeString()
      }
    ]);
  };

  const toggleMic = () => {
    setMicEnabled(prev => !prev);
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

      // Log the full response for debugging
      console.log('Start agent API response:', JSON.stringify(payload, null, 2));

      if (payload.success === false) {
        throw new Error(payload.error || 'start-agent failed');
      }

      // Check multiple possible locations for agent_id and channel_name
      const newAgentId = 
        payload.agent_id || 
        payload.data?.agent_id || 
        payload.result?.agent_id ||
        null;
      
      const newChannelName = 
        payload.channel_name || 
        payload.data?.channel_name || 
        payload.result?.channel_name ||
        null;
      
      const rtcUid = normalizeRtcUid(
        payload.rtc_uid || 
        payload.data?.rtc_uid || 
        payload.result?.rtc_uid || 
        userId
      );
      
      const isNew = payload.is_new || payload.data?.is_new || payload.result?.is_new;

      if (!newAgentId || !newChannelName) {
        console.error('API response structure:', payload);
        throw new Error(`Missing agent_id or channel_name in API response. Response: ${JSON.stringify(payload)}`);
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

  const handleSendVoice = async () => {
    if (!agentId || !textInput.trim()) return;
    const text = textInput.trim();
    setTextInput('');
    pushMessage({ from: 'user', text });

    try {
      setIsSending(true);
      const res = await api.post(withPrefix('/send-text'), {
        agent_id: agentId,
        message: text
      });

      const success = res.data?.success ?? res.data?.ok ?? true;
      if (!success) {
        throw new Error(res.data?.error || 'send-text failed');
      }

      pushMessage({
        from: 'system',
        text: 'AI is speaking this message in the voice channel…'
      });
    } catch (error) {
      console.error('Send text failed:', error);
      pushMessage({ from: 'system', text: `Failed to send text: ${error.message}` });
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
    setIsConnected(false);
    await client.leave();
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

  return (
    <div className="voice-card">
      {!USER_ACCESS_TOKEN && (
        <div className="banner warn">
          REACT_APP_USER_ACCESS_TOKEN is not set. Requests will be rejected with 401.
        </div>
      )}

      <div className="panel">
        <div style={{overflow: 'scroll'}}>
          <div className="label">Agent ID</div>
          <div className="value">{agentId || '—'}</div>
        </div>
        <div style={{overflow: 'scroll'}}>
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
          placeholder="Type text for the agent"
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendVoice()}
        />
        <button onClick={handleSendVoice} disabled={!agentId || !textInput.trim() || isSending}>
          {isSending ? 'Sending…' : 'Send Text'}
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

export default AgoraConversationalAI;