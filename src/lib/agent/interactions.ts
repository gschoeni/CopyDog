export interface ChoiceOption {
  label: string;
  description: string;
}

/**
 * A durable, client-rendered interaction requested by the agent. Stored on an
 * assistant chat message so it survives reloads and is extensible beyond
 * choices (for example: confirmation or structured form interactions).
 */
export type ChatInteraction = {
  type: "choice";
  question: string;
  options: ChoiceOption[];
};

/**
 * How a stored interaction reads back to the model in conversation history.
 * Interaction turns often carry no prose, so without this the agent would
 * forget its own question by the time the user answers it.
 */
export function describeInteraction(interaction: ChatInteraction): string {
  switch (interaction.type) {
    case "choice":
      return `[Asked the user to choose: "${interaction.question}" — options: ${interaction.options
        .map((option) => option.label)
        .join(" / ")}]`;
  }
}
