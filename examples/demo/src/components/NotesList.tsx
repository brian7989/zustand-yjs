import { Stack, Group, Text, ActionIcon, UnstyledButton } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useStore } from "zustand";
import { store } from "../store";
import classes from "./NotesList.module.css";

export function NotesList() {
  const { notes, selectedId, add, select } = useStore(store);

  return (
    <>
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">Notes</Text>
        <ActionIcon variant="subtle" color="gray" onClick={add}>
          <IconPlus size={18} />
        </ActionIcon>
      </Group>

      <Stack gap={4}>
        {notes.map((n) => (
          <UnstyledButton
            key={n.id}
            onClick={() => select(n.id)}
            px="sm"
            py={6}
            className={n.id === selectedId ? classes.selected : classes.item}
          >
            <Text size="sm" truncate fw={n.id === selectedId ? 600 : 400}>
              {n.title || "Untitled"}
            </Text>
          </UnstyledButton>
        ))}
      </Stack>
    </>
  );
}
