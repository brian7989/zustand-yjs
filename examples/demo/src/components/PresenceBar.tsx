import { Group, Avatar, Tooltip } from "@mantine/core";
import { useConnection, usePresence } from "../hooks";
import classes from "./PresenceBar.module.css";

export function PresenceBar() {
  const { awareness } = useConnection();
  const { peers } = usePresence(awareness);

  return (
    <Group gap={4} mt="auto" pt="sm" className={classes.bar}>
      {Array.from(peers.entries()).map(([clientId, peer]) => (
        <Tooltip key={clientId} label={peer.name}>
          <Avatar size="sm" color={peer.color} radius="xl">{peer.name[0]}</Avatar>
        </Tooltip>
      ))}
    </Group>
  );
}
