import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, User, Bot, X } from 'lucide-react';
import { generateCanvas } from '../../../konva/js/Generative';

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
  const recognitionRef = useRef<any>(null);

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

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'es-ES';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        setInput(prevInput => prevInput.replace('Estoy grabando...', '') + finalTranscript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Error en el reconocimiento de voz:', event.error);
        if (event.error === 'no-speech') {
          setInput(prevInput => prevInput.replace('Estoy grabando...', '') + " (No se detectó voz, intente de nuevo)");
        } else if (event.error === 'aborted') {
          setInput(prevInput => prevInput.replace('Estoy grabando...', '') + " (Reconocimiento de voz interrumpido)");
        }
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        if (isRecording) {
          recognitionRef.current.start();
        }
      };
    } else {
      console.log('El reconocimiento de voz no está soportado en este navegador.');
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isRecording]);

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
    if (!isRecording) {
      setInput('Estoy grabando...');
      if (recognitionRef.current) {
        recognitionRef.current.start();
      }
    } else {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setInput(prevInput => prevInput.replace('Estoy grabando...', ''));
    }
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
      console.log("Custom event", customEvent.detail);
      if (customEvent.detail.opacity != "1") {
        console.log("Opening chatbot");
        setIsChatbotOpen(true);
      } else {
        console.log("Closing chatbot");
        setIsChatbotOpen(false);
      }
    };

    document.addEventListener("updateStateChatbot", handleUpdateStateChatbot);

    return () => {
      document.removeEventListener("updateStateChatbot", handleUpdateStateChatbot);
    };
  }, []);

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