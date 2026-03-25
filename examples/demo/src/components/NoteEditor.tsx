import { Stack, Group, TextInput, Textarea, Text, ActionIcon } from "@mantine/core";
import { IconArrowBackUp, IconArrowForwardUp, IconTrash } from "@tabler/icons-react";
import { useStore } from "zustand";
import { store } from "../store";
import { useConnection, useUndo } from "../hooks";
import classes from "./NoteEditor.module.css";

export function NoteEditor() {
  const { notes, selectedId, updateTitle, updateBody, remove } = useStore(store);
  const { undoManager } = useConnection();
  const { canUndo, canRedo } = useUndo(undoManager);
  const note = notes.find((n) => n.id === selectedId);

  if (!note) {
    return <Text c="dimmed" ta="center" mt="xl">Select or create a note.</Text>;
  }

  return (
    <Stack h="100%">
      <Group justify="space-between">
        <Group gap={4}>
          <ActionIcon variant="subtle" color="gray" disabled={!canUndo} onClick={() => undoManager.undo()}>
            <IconArrowBackUp size={18} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" disabled={!canRedo} onClick={() => undoManager.redo()}>
            <IconArrowForwardUp size={18} />
          </ActionIcon>
        </Group>
        <ActionIcon variant="subtle" color="gray" onClick={() => remove(note.id)}>
          <IconTrash size={18} />
        </ActionIcon>
      </Group>

      <TextInput
        variant="unstyled"
        placeholder="Note title"
        value={note.title}
        onChange={(e) => updateTitle(note.id, e.currentTarget.value)}
        classNames={{ input: classes.title }}
      />

      <Textarea
        variant="unstyled"
        placeholder="Start writing..."
        value={note.body}
        onChange={(e) => updateBody(note.id, e.currentTarget.value)}
        autosize
        minRows={20}
        classNames={{ input: classes.body }}
      />
    </Stack>
  );
}
