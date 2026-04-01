import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SendOutlined } from '@ant-design/icons'
import './ChatPanel.css'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type Props = {
  messages: ChatMessage[]
  onSendMessage: (text: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  /** Extra element rendered to the left of the text input (e.g. upload button). */
  inputPrefix?: ReactNode
  /** Extra element rendered below the input row (e.g. action buttons). */
  footerSlot?: ReactNode
  className?: string
}

export default function ChatPanel({
  messages,
  onSendMessage,
  placeholder = 'Nachricht schreiben...',
  emptyText = 'Schreibe eine Nachricht, um die Conversation zu starten.',
  disabled = false,
  inputPrefix,
  footerSlot,
  className,
}: Props) {
  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = inputValue.trim()
    if (!text) return
    onSendMessage(text)
    setInputValue('')
  }

  return (
    <div className={`chat-panel${className ? ` ${className}` : ''}`}>
      <div className="chat-panel-log">
        {messages.length === 0 ? (
          <p className="chat-panel-empty">{emptyText}</p>
        ) : (
          messages.map((message) => (
            <p
              key={message.id}
              className={`chat-panel-message ${
                message.role === 'assistant'
                  ? 'chat-panel-message-assistant'
                  : 'chat-panel-message-user'
              }`}
            >
              {message.text}
            </p>
          ))
        )}
        <div ref={bottomAnchorRef} />
      </div>

      <form className="chat-panel-input-row" onSubmit={handleSubmit}>
        {inputPrefix}
        <input
          className="chat-panel-input"
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          type="submit"
          className="chat-panel-send"
          aria-label="Nachricht senden"
          disabled={disabled}
        >
          <SendOutlined />
        </button>
      </form>

      {footerSlot}
    </div>
  )
}
