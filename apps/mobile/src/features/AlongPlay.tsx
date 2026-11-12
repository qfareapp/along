// Old game links resolve into the owning chat; all gameplay now lives there.
import { Redirect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator } from "react-native";
import { usePlayQuery, type PlayState } from "../services/play";
import { Screen, Notice } from "../components/ui";

export function AlongPlayHome() {
  const { conversation } = useLocalSearchParams<{ conversation?: string }>();
  return (
    <Redirect
      href={conversation ? `/conversation?id=${conversation}` : "/(tabs)/chat"}
    />
  );
}
export function ThisOrThatGame({ id }: { id: string }) {
  const game = usePlayQuery<PlayState>(`/sessions/${id}`, !!id);
  if (game.data)
    return <Redirect href={`/conversation?id=${game.data.conversationId}`} />;
  return (
    <Screen>
      {game.isError ? (
        <Notice>
          This game is unavailable. Open your matched chat to play.
        </Notice>
      ) : (
        <ActivityIndicator />
      )}
    </Screen>
  );
}
export function PlayMakePlan() {
  return <Redirect href="/(tabs)/chat" />;
}
