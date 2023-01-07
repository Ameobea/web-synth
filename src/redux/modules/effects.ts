export interface Effect {
  id: number;
  title: string;
  description: string;
  code: string;
  userId: number | null;
  userName: string | null;
}
