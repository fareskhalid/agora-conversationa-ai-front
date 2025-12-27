import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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

  const playedTracksRef = useRef(new Set());
  const hasPublishedRef = useRef(false);
  const [userId, setUserId] = useState(null);
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

  const pushMessage = useCallback((payload) => {
    setMessages(prev => [
      ...prev,
      {
        ...payload,
        time: payload.time || new Date().toLocaleTimeString()
      }
    ]);
  }, []);

  // Create local microphone track manually
  useEffect(() => {
    if (!micEnabled) {
      if (localMicrophoneTrack) {
        localMicrophoneTrack.setEnabled(false).catch(console.error);
        // Optionally close it instead
        // localMicrophoneTrack.close();
        // setLocalMicrophoneTrack(null);
      }
      return;
    }

    let track;
    const createTrack = async () => {
      // Check permissions first
      let hasPermission = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop()); // Stop immediately, just checking
        console.log('Microphone permission granted');
        hasPermission = true;
      } catch (err) {
        console.error('Microphone permission denied:', err);
        pushMessage({ from: 'system', text: `Microphone permission denied: ${err.message}` });
        hasPermission = false;
      }
      
      if (!hasPermission) return;

      try {
        track = await AgoraRTC.createMicrophoneAudioTrack();
        // Explicitly enable the track
        await track.setEnabled(true);
        await track.setMuted(false);
        setLocalMicrophoneTrack(track);
        console.log('Local microphone track created and enabled');
        
        // Verify the track is working
        const mediaStreamTrack = track.getMediaStreamTrack();
        if (mediaStreamTrack) {
          console.log('Track state:', mediaStreamTrack.readyState, mediaStreamTrack.enabled);
        }
      } catch (err) {
        console.error('Failed to create microphone track:', err);
        pushMessage({ from: 'system', text: `Mic error: ${err.message}` });
      }
    };

    createTrack();

    return () => {
      if (track) {
        track.close();
      }
    };
  }, [micEnabled, pushMessage]);

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
    if (!channelName || !rtcToken || !userId) return;

    const join = async () => {
      try {
        // Make sure we're not already connected
        if (client.connectionState === 'CONNECTED') {
          console.log('Already connected to channel');
          return;
        }

        await client.join(appId, channelName, rtcToken, joinUid);
        setIsConnected(true);
        console.log('Joined channel successfully, connection state:', client.connectionState);
      } catch (err) {
        console.error('Join failed:', err);
        setIsConnected(false);
      }
    };

    join();
  }, [channelName, rtcToken, userId, client, appId, joinUid]);

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

    // Prevent duplicate publishing
    if (hasPublishedRef.current) {
      console.log('Already published, skipping duplicate publish');
      return;
    }

    const publish = async () => {
      try {
        // Wait a bit to ensure connection is stable
        await new Promise(resolve => setTimeout(resolve, 500));

        // Double-check connection state
        if (client.connectionState !== 'CONNECTED') {
          console.warn('Not connected, skipping publish. State:', client.connectionState);
          return;
        }

        // Check if already published
        const publishedTracks = client.localTracks;
        const trackId = localMicrophoneTrack.getTrackId();
        if (publishedTracks.some(t => t.getTrackId() === trackId)) {
          console.log('Track already published');
          hasPublishedRef.current = true;
          return;
        }

        // Ensure track is enabled before publishing
        await localMicrophoneTrack.setEnabled(true);
        await localMicrophoneTrack.setMuted(false);
        
        await client.publish([localMicrophoneTrack]);
        hasPublishedRef.current = true;
        console.log('Microphone published successfully');
        console.log('Published tracks:', client.localTracks);
      } catch (err) {
        console.error('Publish failed:', err);
        hasPublishedRef.current = false;
        pushMessage({ from: 'system', text: `Publish error: ${err.message}` });
      }
    };

    publish();

    // Cleanup: unpublish when disconnecting
    return () => {
      if (hasPublishedRef.current) {
        client.unpublish([localMicrophoneTrack]).catch(err => {
          console.error('Unpublish error:', err);
        });
        hasPublishedRef.current = false;
      }
    };
  }, [isConnected, localMicrophoneTrack, client, pushMessage]);

  // Handle remote users publishing/unpublishing audio
  useEffect(() => {
    const handleUserPublished = async (user, mediaType) => {
      if (mediaType === 'audio') {
        console.log('User published audio:', user.uid);
        try {
          await client.subscribe(user, mediaType);
          console.log('Subscribed to user:', user.uid);
          
          if (user.audioTrack) {
            // Play the audio track only once
            user.audioTrack.play();
            console.log('Playing audio track from UID:', user.uid);
            
            // Update state to track this user
            setRemoteUsers(prev => {
              if (prev.some(u => u.uid === user.uid)) return prev;
              return [...prev, user];
            });
            
            setAudioTracks(prev => {
              // Prevent duplicate tracks
              if (prev.some(t => t.getTrackId() === user.audioTrack.getTrackId())) {
                return prev;
              }
              return [...prev, user.audioTrack];
            });
          }
        } catch (err) {
          console.error('Subscribe failed:', err);
        }
      }
    };

    const handleUserUnpublished = (user, mediaType) => {
      if (mediaType === 'audio') {
        console.log('User unpublished audio:', user.uid);
        setRemoteUsers(prev => prev.filter(u => u.uid !== user.uid));
        if (user.audioTrack) {
          setAudioTracks(prev => 
            prev.filter(t => t.getTrackId() !== user.audioTrack.getTrackId())
          );
        }
      }
    };

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
        setAudioTracks(prev => 
          prev.filter(t => t.getTrackId() !== user.audioTrack.getTrackId())
        );
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

  /*
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
*/
  const toggleMic = async () => {
    if (localMicrophoneTrack) {
      try {
        const newState = !micEnabled;
        await localMicrophoneTrack.setEnabled(newState);
        await localMicrophoneTrack.setMuted(!newState);
        setMicEnabled(newState);
        console.log(`Microphone ${newState ? 'enabled' : 'disabled'}`);
      } catch (err) {
        console.error('Failed to toggle microphone:', err);
        pushMessage({ from: 'system', text: `Mic toggle error: ${err.message}` });
      }
    } else if (micEnabled) {
      // If track doesn't exist but micEnabled is true, create it
      setMicEnabled(false);
      setMicEnabled(true); // This will trigger the useEffect to create the track
    }
  };

  // Add this useEffect to monitor audio levels
  useEffect(() => {
    if (!localMicrophoneTrack || !isConnected) return;

    const checkAudioLevel = async () => {
      try {
        // Ensure method exists and is callable
        if (typeof localMicrophoneTrack.getStats !== 'function') {
          // Comment this out later if too noisy
          console.warn('localMicrophoneTrack.getStats is not available');
          return;
        }

        const stats = await localMicrophoneTrack.getStats();
        if (stats && stats.sendAudioLevel != null) {
          console.log('Audio level:', stats.sendAudioLevel);
        }
      } catch (err) {
        console.error('Error reading audio level:', err);
      }
    };

    const interval = setInterval(checkAudioLevel, 1000);
    return () => clearInterval(interval);
  }, [localMicrophoneTrack, isConnected]);

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
      setChannelName(newChannelName);
      setUserId(rtcUid);

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
      // Unpublish before leaving
      if (localMicrophoneTrack && hasPublishedRef.current) {
        await client.unpublish([localMicrophoneTrack]).catch(console.error);
      }
      
      // Leave channel
      await client.leave();
      
      // Stop agent on server
      await api.post(withPrefix('/stop-agent'), { agent_id: agentId });
    } catch (error) {
      console.error('stop agent error:', error);
    }

    // Reset all refs
    playedTracksRef.current.clear();
    hasPublishedRef.current = false;
    
    // Clear state
    pushMessage({ from: 'system', text: 'Agent stopped' });
    setAgentId(null);
    setChannelName('');
    setRtcToken(null);
    setUserId(null);
    setIsConnected(false);
    setRemoteUsers([]);
    setAudioTracks([]);
    setMessages([]);

    // Close microphone track
    if (localMicrophoneTrack) {
      localMicrophoneTrack.close();
      setLocalMicrophoneTrack(null);
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