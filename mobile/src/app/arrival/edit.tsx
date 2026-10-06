import { useLocalSearchParams } from 'expo-router';

import { pick } from '@/lib/params';

import { ArrivalFormScreen } from './new';

/** `PATCH /arrivals/:id` — reprend la saisie de création préremplie. */
export default function EditArrivalScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  return <ArrivalFormScreen editId={pick(params.id) || null} />;
}
