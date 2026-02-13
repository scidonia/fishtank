"""LLM integration for agent decision-making."""

import json
import os
from typing import Dict, Any, Optional
from abc import ABC, abstractmethod

import httpx


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def generate(self, prompt: str, system_prompt: str) -> str:
        """Generate a response from the LLM."""
        pass


class DeepSeekProvider(LLMProvider):
    """DeepSeek v3 LLM provider."""

    def __init__(self, api_key: Optional[str] = None, model: str = "deepseek-chat"):
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
        self.model = model
        self.base_url = "https://api.deepseek.com/v1"

        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY environment variable not set")

    async def generate(self, prompt: str, system_prompt: str) -> str:
        """Generate a response from DeepSeek API."""
        timeout = httpx.Timeout(10.0, read=60.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 500,
                },
            )

            response.raise_for_status()
            data = response.json()

            return data["choices"][0]["message"]["content"]


class MockLLMProvider(LLMProvider):
    """Mock LLM for testing without API calls."""

    async def generate(self, prompt: str, system_prompt: str) -> str:
        """Generate a simple heuristic response."""
        # Simple heuristic based on prompt content
        import random

        if "hunger" in prompt.lower() and "20" in prompt:
            # Low hunger - prioritize foraging
            return json.dumps(
                {
                    "action": "forage",
                    "args": {},
                    "reasoning": "Hunger is critical, need to find food",
                }
            )

        if "health" in prompt.lower() and any(str(i) in prompt for i in range(0, 30)):
            # Low health - be cautious
            return json.dumps(
                {
                    "action": "wait",
                    "args": {},
                    "reasoning": "Health is low, staying safe",
                }
            )

        # Random movement
        directions = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"]
        return json.dumps(
            {
                "action": "move",
                "args": {"dir": random.choice(directions)},
                "reasoning": "Exploring the world",
            }
        )


class LLMDecisionMaker:
    """Makes decisions using LLM based on agent personality and observations."""

    def __init__(self, provider: LLMProvider):
        self.provider = provider

    async def decide(self, base_prompt: str, observation_prompt: str) -> Dict[str, Any]:
        """
        Make a decision based on the agent's prompt and current observation.

        Returns a dict with: action, args, reasoning
        """
        full_prompt = f"{observation_prompt}"

        try:
            response = await self.provider.generate(full_prompt, base_prompt)

            # Try to parse JSON response
            # Handle both raw JSON and JSON in markdown code blocks
            response = response.strip()
            if response.startswith("```json"):
                response = response.split("```json")[1].split("```")[0].strip()
            elif response.startswith("```"):
                response = response.split("```")[1].split("```")[0].strip()

            decision = json.loads(response)

            # Validate decision format
            if "action" not in decision:
                raise ValueError("Missing 'action' in response")

            # Ensure args exists
            if "args" not in decision:
                decision["args"] = {}

            return decision

        except json.JSONDecodeError as e:
            # Fallback to wait if parsing fails
            return {
                "action": "wait",
                "args": {},
                "reasoning": f"Failed to parse LLM response: {e}",
            }
        except Exception as e:
            # Fallback to wait on any error
            return {
                "action": "wait",
                "args": {},
                "reasoning": f"Error generating decision: {e}",
            }


async def create_llm_provider(use_mock: bool = False) -> LLMProvider:
    """Create an LLM provider (DeepSeek or mock for testing)."""
    if use_mock or not os.getenv("DEEPSEEK_API_KEY"):
        return MockLLMProvider()

    return DeepSeekProvider()
