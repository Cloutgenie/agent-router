import { AGENTS } from "@/data/agents";
import { Agent, Capability } from "@/types";

export function getAllAgents(): Agent[] {
  return AGENTS;
}

export function getActiveAgents(): Agent[] {
  return AGENTS.filter((agent) => agent.active);
}

export function getAgentById(id: string): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

export function getAgentsForCapability(capability: Capability): Agent[] {
  return getActiveAgents().filter((agent) =>
    agent.capabilities.includes(capability)
  );
}
