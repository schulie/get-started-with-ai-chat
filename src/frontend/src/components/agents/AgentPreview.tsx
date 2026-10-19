import { ReactNode, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ChatRegular, MoreHorizontalRegular } from "@fluentui/react-icons";

import { SettingsPanel } from "../core/SettingsPanel";
import { AgentPreviewChatBot } from "./AgentPreviewChatBot";
import { MenuButton } from "../core/MenuButton/MenuButton";
import { ChatDraft } from "./chatbot/types";
import { useChatSession, SESSION_IDLE_MINUTES } from "./hooks/useChatSession";

import styles from "./AgentPreview.module.css";

interface IAgent {
  id: string;
  object: string;
  created_at: number;
  name: string;
  description?: string | null;
  model: string;
  instructions?: string;
  tools?: Array<{ type: string }>;
  top_p?: number;
  temperature?: number;
  tool_resources?: {
    file_search?: {
      vector_store_ids?: string[];
    };
    [key: string]: any;
  };
  metadata?: Record<string, any>;
  response_format?: "auto" | string;
}

interface IAgentPreviewProps {
  resourceId: string;
  agentDetails: IAgent;
}

const starterPrompts = [
  { title: "Clinical reference", detail: "Guidance, terminology, and workflows", text: "Help me review a clinical reference question. Explain the relevant evidence, identify uncertainty, and provide sources I can verify. I will provide the question and context." },
  { title: "Billing & coding", detail: "Documentation, codes, and claims", text: "Help me review a billing or coding question. Identify the service date, payer, and documentation needed, explain the rationale, and flag details to verify before a claim is submitted." },
  { title: "Patient communication", detail: "Clear explanations and messages", text: "Help me draft a clear patient education handout or message. I will provide the topic, intended audience, and key points." },
  { title: "Clinic operations", detail: "Policies, checklists, and procedures", text: "Help me create a practical clinic workflow, staff checklist, or procedure. I will describe the task, the staff involved, and the requirements." },
];

export function AgentPreview({ agentDetails }: IAgentPreviewProps): ReactNode {
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const session = useChatSession();
  const { messageList } = session;
  const [draft, setDraft] = useState<ChatDraft>();
  const handleSettingsPanelOpenChange = (isOpen: boolean) => setIsSettingsPanelOpen(isOpen);
  const newThread = () => { session.clearSession(); setDraft(undefined); };

  const menuItems = [
    {
      key: "settings",
      children: "Settings",
      onClick: () => {
        setIsSettingsPanelOpen(true);
      },
    },
    {
      key: "terms",
      children: (
        <a
          className={styles.externalLink}
          href="https://aka.ms/aistudio/terms"
          target="_blank"
          rel="noopener noreferrer"
        >
          Terms of Use
        </a>
      ),
    },
    {
      key: "privacy",
      children: (
        <a
          className={styles.externalLink}
          href="https://go.microsoft.com/fwlink/?linkid=521839"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy
        </a>
      ),
    },
    {
      key: "signout",
      children: "Sign out",
      onClick: () => {
        session.clearSession();
        window.location.assign("/.auth/logout?post_logout_redirect_uri=/");
      },
    },
  ];

  const chatContext = {
    ...session,
    onSend: (text: string, editingId?: string) => { session.onSend(text, editingId); setDraft(undefined); },
    onStop: session.stop,
    onRetry: session.retry,
    onRegenerate: session.regenerate,
  };

  return (
    <div className={styles.container}>
      <header className={styles.topBar}>
        <div className={styles.leftSection}>
          <span className={styles.brandMark} aria-hidden="true">J+</span>
          <div className={styles.brandText}>
            <strong>JMCGPT</strong>
            <span>Jay Medical Clinic</span>
          </div>
        </div>
        <div className={styles.rightSection}>
          {" "}
          <Button
            appearance="subtle"
            icon={<ChatRegular aria-hidden={true} />}
            onClick={newThread}
          >
            New Chat
          </Button>{" "}
          <MenuButton
            menuButtonText=""
            menuItems={menuItems}
            menuButtonProps={{
              appearance: "subtle",
              icon: <MoreHorizontalRegular />,
              "aria-label": "Settings",
            }}
          />
        </div>
      </header>
      <main className={styles.content} data-empty={messageList.length === 0}>
            {messageList.length === 0 && (
              <div className={styles.emptyChatContainer}>
                <span className={styles.eyebrow}>JAY MEDICAL CLINIC STAFF ASSISTANT</span>
                <h1 className={styles.welcomeTitle}>Clinical, billing,<br />and practice support.</h1>
                <p className={styles.welcomeDescription}>A workspace for clinical reference, coding and claims, patient communication, and day-to-day clinic operations.</p>
                <div className={styles.starterGrid} aria-label="Suggested prompts">
                  {starterPrompts.map((prompt, index) => (
                    <button
                      type="button"
                      className={styles.starterCard}
                      key={prompt.title}
                      onClick={() => setDraft((previous) => ({ text: prompt.text, id: (previous?.id ?? 0) + 1 }))}
                    >
                      <span className={styles.starterIndex} aria-hidden="true">0{index + 1}</span>
                      <strong>{prompt.title}</strong>
                      <span className={styles.starterDescription}>{prompt.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {session.notice && <p className={styles.sessionNotice} role="status">{session.notice}</p>}
            <AgentPreviewChatBot
              key={session.sessionVersion}
              agentName={agentDetails.name}
              agentLogo={agentDetails.metadata?.logo}
              chatContext={chatContext}
              draft={draft}
            />
      </main>

      <p className={styles.sessionPolicy}>Session only. Chat clears after {SESSION_IDLE_MINUTES} minutes of inactivity or when this page is reloaded.</p>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={isSettingsPanelOpen}
        onOpenChange={handleSettingsPanelOpenChange}
      />
    </div>
  );
}
