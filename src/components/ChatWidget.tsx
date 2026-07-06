import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Sparkles } from 'lucide-react';
import { ChatMessage } from '../../types';

export function ChatWidget({ onUpdate }: { onUpdate: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: 'Hi Dave and Melinda! I am the Pinecrest RV assistant. How can I help you today? I can help move tenants, upload photos, or answer questions.'
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history: messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })) })
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, { role: 'model', text: data.text }]);
        
        // If a function was called (like moveTenant), refresh the main data
        if (data.functionCalls && data.functionCalls.length > 0) {
           onUpdate();
        }
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 bg-[#5A6355] hover:bg-[#3D3730] text-white rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 z-50 border border-[#E2D9D0]"
      >
        <Sparkles className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-80 sm:w-96 bg-[#FBF9F7] rounded-[32px] shadow-2xl border border-[#E2D9D0] flex flex-col overflow-hidden z-50">
      <div className="bg-[#EDE7E1] p-5 flex items-center justify-between text-[#3D3730] border-b border-[#E2D9D0]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center border border-[#E2D9D0]">
            <Bot className="w-4 h-4 text-[#5A6355]" />
          </div>
          <h3 className="font-serif font-bold text-sm">Pinecrest Assistant</h3>
        </div>
        <button 
          onClick={() => setIsOpen(false)}
          className="text-[#5A6355] hover:text-[#3D3730] transition-colors text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div className="h-96 overflow-y-auto p-4 space-y-4 bg-white">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 text-sm leading-relaxed ${
              msg.role === 'user' 
                ? 'bg-[#5A6355] text-white rounded-[20px] rounded-br-none shadow-sm' 
                : 'bg-[#FBF9F7] border border-[#F0EBE6] text-[#3D3730] shadow-sm rounded-[20px] rounded-bl-none'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] p-3 bg-[#FBF9F7] border border-[#F0EBE6] shadow-sm rounded-[20px] rounded-bl-none flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-[#5A6355] rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-[#5A6355] rounded-full animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-1.5 h-1.5 bg-[#5A6355] rounded-full animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-white border-t border-[#E2D9D0] flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask me anything..."
          className="flex-1 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-[24px] focus:outline-none focus:ring-1 focus:ring-[#5A6355] text-sm italic text-[#3D3730]"
        />
        <button 
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="w-11 h-11 bg-[#5A6355] text-white rounded-full flex items-center justify-center hover:bg-[#3D3730] disabled:opacity-50 transition-colors shadow-sm"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </div>
    </div>
  );
}
