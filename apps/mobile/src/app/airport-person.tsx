import { useLocalSearchParams } from "expo-router";
import { AirportPerson } from "../features/AirportPerson";
export default function AirportPersonRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AirportPerson id={id ?? ""} />;
}
