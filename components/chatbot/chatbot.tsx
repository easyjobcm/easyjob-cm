"use client"


import { useState, useRef, useEffect } from "react"

import { useChat } from "@ai-sdk/react"

import { DefaultChatTransport } from "ai"

import { Send, Bot, User, MessageCircle, X } from "lucide-react"

import { motion } from "framer-motion"

import { useTranslation } from "@/lib/i18n"



interface ChatbotProps {

  darkMode?: boolean

}



export function Chatbot({ darkMode = false }: ChatbotProps) {

  const { t } = useTranslation()

  const [isOpen, setIsOpen] = useState(false)

  const [input, setInput] = useState("")

  const scrollRef = useRef<HTMLDivElement>(null)



  const { messages, sendMessage, status } = useChat({

    transport: new DefaultChatTransport({ api: "/api/chat" }),

  })



  const isLoading = status === "streaming" || status === "submitted"



  // Auto-scroll to bottom when new messages arrive

  useEffect(() => {

    if (scrollRef.current) {

      scrollRef.current.scrollTop = scrollRef.current.scrollHeight

    }

  }, [messages])



  const handleSubmit = (e: React.FormEvent) => {

    e.preventDefault()

    if (!input.trim() || isLoading) return

    sendMessage({ text: input })

    setInput("")

  }



  const quickQuestions = [

    t("chatbot.q1"),

    t("chatbot.q2"),

    t("chatbot.q3"),

    t("chatbot.q4"),

  ]



  // ── Couleurs dynamiques selon dark mode ──────────────────────────────────────

  const panelBg     = darkMode ? "#0F0A1E"                : "#fff"

  const panelBorder = darkMode ? "rgba(124,58,237,0.25)"  : "#E5E7EB"

  const msgBg       = darkMode ? "rgba(255,255,255,0.06)" : "#F3F4F6"

  const textMain    = darkMode ? "#fff"                   : "#111827"

  const inputBg     = darkMode ? "rgba(255,255,255,0.06)" : "#F9FAFB"

  const shadow      = darkMode

    ? "0 16px 64px rgba(124,58,237,0.35), 0 4px 16px rgba(0,0,0,0.5)"

    : "0 8px 48px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)"



  const PANEL_W  = 340

  const PANEL_H  = 500

  const HEADER_H = 56

  const INPUT_H  = 68



  // ── Bouton flottant (état fermé) ───────────────────────────────────────────────────

  if (!isOpen) {

    return (

      <motion.button

        initial={{ opacity: 0, scale: 0.6, y: 30 }}

        animate={{ opacity: 1, scale: 1, y: 0 }}

        transition={{ delay: 0.4, type: "spring", damping: 18, stiffness: 280 }}

        whileHover={{ scale: 1.06 }}

        whileTap={{ scale: 0.92 }}

        onClick={() => setIsOpen(true)}

        className="fixed z-50 flex items-center justify-center rounded-full"

        style={{

          right: 16,

          bottom: `calc(16px + env(safe-area-inset-bottom, 0px))`,

          width: 56,

          height: 56,

          background: "linear-gradient(135deg,#7C3AED,#5B21B6)",

          boxShadow: "0 8px 24px rgba(124,58,237,0.45), 0 4px 12px rgba(0,0,0,0.18)",

        }}

        aria-label={t("chatbot.openChat")}

      >

        <MessageCircle className="w-6 h-6 text-white" />

        <span

          className="absolute inset-0 rounded-full pointer-events-none"

          style={{

            boxShadow: "0 0 0 0 rgba(124,58,237,0.55)",

            animation: "ej-pulse 2.2s ease-out infinite",

          }}

        />

        <style jsx>{`

          @keyframes ej-pulse {

            0%   { box-shadow: 0 0 0 0 rgba(124,58,237,0.55); }

            70%  { box-shadow: 0 0 0 18px rgba(124,58,237,0); }

            100% { box-shadow: 0 0 0 0 rgba(124,58,237,0); }

          }

        `}</style>

      </motion.button>

    )

  }



  // ── Panneau ouvert ─────────────────────────────────────────────────────────────────

  return (

    <motion.div

      initial={{ opacity: 0, y: 28, scale: 0.94 }}

      animate={{ opacity: 1, y: 0, scale: 1 }}

      exit={{ opacity: 0, y: 20, scale: 0.94 }}

      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}

      style={{

        position: "fixed",

        right: 16,

        bottom: `calc(16px + env(safe-area-inset-bottom, 0px))`,

        zIndex: 50,

        width: `min(${PANEL_W}px, calc(100vw - 32px))`,

        height: `min(${PANEL_H}px, calc(100vh - 32px))`,

        background: panelBg,

        border: `1px solid ${panelBorder}`,

        borderRadius: 24,

        overflow: "hidden",

        transition: "background 0.3s, border-color 0.3s",

        boxShadow: shadow,

        display: "flex",

        flexDirection: "column",

      }}

    >

      {/* ── Header ──────────────────────────────────────────────────────────────── */}

      <div

        className="flex items-center justify-between px-4 shrink-0 select-none"

        style={{

          height: HEADER_H,

          background: "linear-gradient(135deg,#7C3AED,#5B21B6)",

          boxShadow: "0 2px 16px rgba(124,58,237,0.35)",

        }}

      >

        <div className="flex items-center gap-2.5">

          <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center">

            <Bot className="w-4 h-4 text-white" />

          </div>

          <div>

            <p className="text-[13px] font-bold text-white leading-none mb-0.5">{t("chatbot.name")}</p>

            <div className="flex items-center gap-1.5">

              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />

              <p className="text-[10px] text-white/60">{t("chatbot.status")}</p>

            </div>

          </div>

        </div>



        <motion.button

          whileTap={{ scale: 0.88 }}

          onClick={() => setIsOpen(false)}

          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"

          aria-label={t("chatbot.closeChat")}

        >

          <X className="w-4 h-4 text-white" />

        </motion.button>

      </div>



      {/* ── Body ─────────────────────────────────────────────────────────────────────────── */}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

            {/* Messages */}

            <div

              ref={scrollRef}

              className="flex-1 overflow-y-auto p-4 space-y-3"

              style={{ minHeight: 0 }}

            >

              {messages.length === 0 ? (

                <div className="space-y-4">

                  <div className="flex items-start gap-2.5">

                    <div

                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"

                      style={{ background: darkMode ? "rgba(124,58,237,0.22)" : "#EDE9FE" }}

                    >

                      <Bot className="w-3.5 h-3.5" style={{ color: darkMode ? "#C4B5FD" : "#7C3AED" }} />

                    </div>

                    <div

                      className="text-[13px] leading-relaxed p-3 max-w-[82%]"

                      style={{ background: msgBg, color: textMain, borderRadius: "4px 16px 16px 16px" }}

                    >

                      {t("chatbot.greeting")}

                    </div>

                  </div>



                  <div className="flex flex-wrap gap-2 pl-10">

                    {quickQuestions.map((q, i) => (

                      <button

                        key={i}

                        onClick={() => { setInput(q); sendMessage({ text: q }) }}

                        className="px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors"

                        style={{

                          color: darkMode ? "#C4B5FD" : "#7C3AED",

                          borderColor: darkMode ? "rgba(124,58,237,0.35)" : "#DDD6FE",

                          background: darkMode ? "rgba(124,58,237,0.12)" : "#F5F3FF",

                        }}

                      >

                        {q}

                      </button>

                    ))}

                  </div>

                </div>

              ) : (

                <div className="space-y-3">

                  {messages.map((message) => (

                    <div

                      key={message.id}

                      className={`flex items-end gap-2 ${message.role === "user" ? "flex-row-reverse" : ""}`}

                    >

                      <div

                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"

                        style={{

                          background: message.role === "user"

                            ? "#7C3AED"

                            : darkMode ? "rgba(124,58,237,0.22)" : "#EDE9FE",

                        }}

                      >

                        {message.role === "user"

                          ? <User className="w-3.5 h-3.5 text-white" />

                          : <Bot className="w-3.5 h-3.5" style={{ color: darkMode ? "#C4B5FD" : "#7C3AED" }} />}

                      </div>



                      <div

                        className="p-3 text-[13px] leading-relaxed max-w-[78%]"

                        style={

                          message.role === "user"

                            ? { background: "linear-gradient(135deg,#7C3AED,#5B21B6)", color: "#fff", borderRadius: "16px 16px 4px 16px" }

                            : { background: msgBg, color: textMain, borderRadius: "4px 16px 16px 16px" }

                        }

                      >

                        {message.parts.map((part, idx) => {

                          if (part.type === "text") return <p key={idx} className="whitespace-pre-wrap">{part.text}</p>

                          return null

                        })}

                      </div>

                    </div>

                  ))}



                  {isLoading && (

                    <div className="flex items-end gap-2">

                      <div

                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"

                        style={{ background: darkMode ? "rgba(124,58,237,0.22)" : "#EDE9FE" }}

                      >

                        <Bot className="w-3.5 h-3.5" style={{ color: darkMode ? "#C4B5FD" : "#7C3AED" }} />

                      </div>

                      <div className="p-3" style={{ background: msgBg, borderRadius: "4px 16px 16px 16px" }}>

                        <div className="flex gap-1">

                          <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-bounce" />

                          <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-bounce" style={{ animationDelay: "0.1s" }} />

                          <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-bounce" style={{ animationDelay: "0.2s" }} />

                        </div>

                      </div>

                    </div>

                  )}

                </div>

              )}

            </div>



            {/* Input */}

            <div className="p-3 border-t" style={{ borderColor: panelBorder, height: INPUT_H }}>

              <form onSubmit={handleSubmit} className="flex gap-2 items-center">

                <input

                  value={input}

                  onChange={(e) => setInput(e.target.value)}

                  placeholder={t("chatbot.placeholder")}

                  disabled={isLoading}

                  className="flex-1 h-10 px-4 rounded-full text-[13px] outline-none border transition-colors placeholder:text-[#9CA3AF]"

                  style={{ background: inputBg, borderColor: panelBorder, color: textMain }}

                />

                <motion.button

                  type="submit"

                  disabled={isLoading || !input.trim()}

                  whileTap={{ scale: 0.88 }}

                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all"

                  style={{

                    background: input.trim()

                      ? "linear-gradient(135deg,#7C3AED,#5B21B6)"

                      : darkMode ? "rgba(255,255,255,0.07)" : "#F3F4F6",

                    boxShadow: input.trim() ? "0 4px 12px rgba(124,58,237,0.4)" : "none",

                  }}

                >

                  <Send

                    className={`w-4 h-4 ${

                      input.trim() ? "text-white" : darkMode ? "text-white/25" : "text-[#9CA3AF]"

                    }`}

                  />

                </motion.button>

              </form>

            </div>

      </div>

    </motion.div>

  )

} 