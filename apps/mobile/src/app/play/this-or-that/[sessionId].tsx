import { useLocalSearchParams } from "expo-router";
import { ThisOrThatGame } from "../../../features/AlongPlay";
export default function Game() {
  const { sessionId = "" } = useLocalSearchParams<{ sessionId: string }>();
  return <ThisOrThatGame id={sessionId} />;
}
