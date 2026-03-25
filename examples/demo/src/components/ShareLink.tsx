import { Group, Text, ActionIcon } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { useClipboard } from "@mantine/hooks";

export function ShareLink() {
  const clipboard = useClipboard();

  return (
    <Group gap={4}>
      <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => clipboard.copy(location.href)}>
        <IconLink size={14} />
      </ActionIcon>
      <Text size="xs" c="dimmed">{clipboard.copied ? "Copied!" : "Share link"}</Text>
    </Group>
  );
}
