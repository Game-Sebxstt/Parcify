import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, User, Bot, X } from 'lucide-react';
import { generateCanvas, toggleRecording } from '../../../konva/js/Generative.js';

interface Message {
  text: string;
  isUser: boolean;
  timestamp: Date;
}

const Chatbot: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const onClose = () => {
    setIsChatbotOpen(false);
  }

  const handleSendMessage = async () => {
    if (input.trim() === '') return;

    const newMessage: Message = { text: input, isUser: true, timestamp: new Date() };
    setMessages([...messages, newMessage]);
    setInput('');
    setIsLoading(true);

    const canvas = await generateCanvas(input);

    const botResponse: Message = { 
      text: canvas.resume, 
      isUser: false, 
      timestamp: new Date() 
    };
    setMessages(prevMessages => [...prevMessages, botResponse]);
    setIsLoading(false);
  };

  const handleRecordAudio = () => {
    setIsRecording(prevState => !prevState);
    toggleRecording();
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    const handleUpdateStateChatbot = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail.opacity != "1") {
        setIsChatbotOpen(true);
      } else {
        setIsChatbotOpen(false);
      }
    };

    document.addEventListener("updateStateChatbot", handleUpdateStateChatbot);

    return () => {
      document.removeEventListener("updateStateChatbot", handleUpdateStateChatbot);
    };
  }, []);

  document.addEventListener("updateRecording", (e: Event) => {
    const customEvent = e as CustomEvent;
    setInput(customEvent.detail.recording);
  })

  return (
    <div id='chat-bot' className={`w-[350px] bg-[#1E1E1E] rounded-lg shadow-lg overflow-hidden absolute -top-6 right-1/2 translate-x-1/2 -translate-y-full transition-all duration-500 ease-in-out ${
          isChatbotOpen 
            ? 'scale-100 opacity-100 -translate-y-full' 
            : 'scale-0 opacity-0 translate-y-0'
        }`}>
      <div className="p-4 bg-[#313131] text-white font-bold flex items-center justify-between">
        <span>Chat Collaborators</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={24} />
        </button>
      </div>
      <div ref={chatContainerRef} className="h-96 overflow-y-auto p-4 space-y-4 bg-[#1E1E1E] custom-scrollbar">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div className="flex items-end space-x-2 max-w-[80%]">
              {!message.isUser && (
                <div className="w-8 h-8 rounded-full bg-blue-500 flex-shrink-0 flex items-center justify-center">
                  <Bot size={20} className="text-white" />
                </div>
              )}
              <div
                className={`p-3 rounded-lg break-words ${
                  message.isUser
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                    : 'bg-[#313131] text-white'
                }`}
              >
                <p>{message.text}</p>
                <p className="text-xs text-gray-300 mt-1">{formatTimestamp(message.timestamp)}</p>
              </div>
              {message.isUser && (
                <div className="w-8 h-8 rounded-full bg-gray-500 flex-shrink-0 flex items-center justify-center">
                  <User size={20} className="text-white" />
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                <Bot size={20} className="text-white" />
              </div>
              <div className="bg-[#313131] p-3 rounded-lg">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="p-4 border-t border-gray-700 bg-[#1E1E1E]">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <button
              id='record-audio'
              onClick={handleRecordAudio}
              className={`p-2 rounded-full ${isRecording ? 'bg-red-500' : 'bg-gray-700'} text-white focus:outline-none transition-colors duration-300 z-10 relative`}
            >
              <Mic size={20} className={isRecording ? 'animate-pulse' : ''} />
            </button>
            {isRecording && (
              <div className="absolute -inset-1 bg-red-500 rounded-full opacity-25 animate-ping pointer-events-none"></div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-grow p-2 rounded-lg bg-[#313131] text-white focus:outline-none resize-none overflow-hidden"
            placeholder="Escribe tu mensaje..."
            rows={1}
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSendMessage}
            className="p-2 bg-[#3B82F6] text-white rounded-lg hover:bg-blue-600 focus:outline-none"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chatbot;