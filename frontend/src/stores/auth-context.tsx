import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { authService, type UserDTO } from "@/services/auth";
interface AuthContextType {
  user: UserDTO | null;
  loading: boolean;
  authError: string | null;
  isAuthenticated: boolean;
  login: (user: UserDTO) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const checkAuth = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await authService.getProfile();
      setUser(res.data);
      setAuthError(null);
      return true;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 401 || status === 403) {
        setUser(null);
        setAuthError(null);
      } else setAuthError("暂时无法验证登录状态，请重试。");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);
  useEffect(() => {
    const clear = () => {
      setUser(null);
      setAuthError(null);
    };
    window.addEventListener("infranexus:unauthorized", clear);
    return () => window.removeEventListener("infranexus:unauthorized", clear);
  }, []);
  const login = (value: UserDTO) => {
    setUser(value);
    setAuthError(null);
  };
  const logout = async () => {
    await authService.logout();
    setUser(null);
    setAuthError(null);
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        isAuthenticated: !!user,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
