import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Text,
} from "@chakra-ui/react";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE_MS = 30 * 1000;    // warn 30 seconds before logout

const IdleWatcher = () => {
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const logoutTimer = useRef(null);
  const warningTimer = useRef(null);
  const countdownInterval = useRef(null);

  const logout = () => {
    localStorage.removeItem("token");
    navigate("/");
  };

  const resetTimers = () => {
    clearTimeout(logoutTimer.current);
    clearTimeout(warningTimer.current);
    clearInterval(countdownInterval.current);
    setShowWarning(false);
    setCountdown(30);

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(30);
      countdownInterval.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);

    logoutTimer.current = setTimeout(() => {
      logout();
    }, IDLE_TIMEOUT_MS);
  };

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach((e) => window.addEventListener(e, resetTimers));
    resetTimers();

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimers));
      clearTimeout(logoutTimer.current);
      clearTimeout(warningTimer.current);
      clearInterval(countdownInterval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal isOpen={showWarning} onClose={() => {}} isCentered closeOnOverlayClick={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Session Timeout Warning</ModalHeader>
        <ModalBody>
          <Text>
            You've been inactive for a while. You'll be logged out in{" "}
            <Text as="span" fontWeight="bold" color="red.500">
              {countdown}s
            </Text>
            .
          </Text>
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="blue" onClick={resetTimers}>
            Stay Logged In
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem("token");

  if (!token) return <Navigate to="/" />;

  try {
    // Decode the JWT payload (base64) to check expiry — no secret needed client-side
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem("token");
      return <Navigate to="/" />;
    }
  } catch {
    // Malformed token
    localStorage.removeItem("token");
    return <Navigate to="/" />;
  }

  return (
    <>
      <IdleWatcher />
      {children}
    </>
  );
};

export default PrivateRoute;
