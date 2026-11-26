export type UserRole = 'admin' | 'manager' | 'rep';

export type UserView = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  color?: string;
  active?: boolean;
  region?: string;
  onLeave?: boolean;
  products?: string[];
};

export type AuthMeResponse = {
  user: UserView | null;
  mustChange: boolean | null;
};

export type AuthSessionResponse = {
  user: UserView;
  mustChange: boolean;
};