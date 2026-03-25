import { Suspense } from "react";
import { AppShell, Stack, Text } from "@mantine/core";
import { NotesList, NoteEditor, PresenceBar, ShareLink, CursorOverlay } from "./components";

const { Navbar, Main } = AppShell;

export function App() {
  return (
    <Suspense fallback={<Text ta="center" mt="xl" c="dimmed">Connecting...</Text>}>
      <CursorOverlay>
        <AppShell navbar={{ width: 260, breakpoint: 0 }} padding="lg">
          <Navbar p="sm" style={{ display: "flex", flexDirection: "column" }}>
            <NotesList />
            <Stack gap="xs" mt="auto" pt="sm">
              <PresenceBar />
              <ShareLink />
            </Stack>
          </Navbar>
          <Main>
            <NoteEditor />
          </Main>
        </AppShell>
      </CursorOverlay>
    </Suspense>
  );
}
