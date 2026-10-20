import { AgentPreview } from "./agents/AgentPreview";
import { ThemeProvider } from "./core/theme/ThemeProvider";

const App: React.FC = () => {
  // State to store the agent details
  const agentDetails ={
      id: "chatbot",
      object: "chatbot",
      created_at: Date.now(),
      name: "Jay Medical Clinic Assistant",
      description: "Session-only staff assistant.",
      model: "default",
      metadata: {
        logo: "Avatar_Default.svg",
      },
  };

  return (
    <ThemeProvider>
      <div className="app-container">
        <AgentPreview
          resourceId="sample-resource-id"
          agentDetails={agentDetails}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
