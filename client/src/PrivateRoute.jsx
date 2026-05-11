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

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_BEFORE_MS = 30 * 1000;
const WORKDAY_END_HOUR = 16; // 4pm

const isWorkHours = () => {
  const h = new Date().getHours();
  return h < WORKDAY_END_HOUR;
};

const msUntil4pm = () => {
  const end = new Date();
  end.setHours(WORKDAY_END_HOUR, 0, 0, 0);
  return end - Date.now();
};

// Noblesse users: no idle timeout during work hours (6am–4pm).
// After 4pm, the standard 15-min idle timeout applies.
const NoblesseWatcher = () => {
  const navigate = useNavigate();
  const [inWorkHours, setInWorkHours] = useState(isWorkHours());
  const logoutTimer = useRef(null);
  const warningTimer = useRef(null);
  const countdownInterval = useRef(null);
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(30);

  // Flip out of work-hours mode at exactly 4pm
  useEffect(() => {
    if (!inWorkHours) return;
    const ms = msUntil4pm();
    if (ms <= 0) { setInWorkHours(false); return; }
    const t = setTimeout(() => setInWorkHours(false), ms);
    return () => clearTimeout(t);
  }, [inWorkHours]);

  // Idle timeout — only active after 4pm
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
          if (prev <= 1) { clearInterval(countdownInterval.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);

    logoutTimer.current = setTimeout(logout, IDLE_TIMEOUT_MS);
  };

  useEffect(() => {
    if (inWorkHours) return;
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
  }, [inWorkHours]);

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

// Standard users: 15-minute idle timeout with warning
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

const decodeToken = (token) => {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
};

// allowedRoles: if provided, only those roles can access this route.
// noblesse users are always redirected to /noblesse; all others to /home.
const PrivateRoute = ({ children, allowedRoles }) => {
  const token = localStorage.getItem("token");

  if (!token) return <Navigate to="/" />;

  const payload = decodeToken(token);

  if (!payload) {
    localStorage.removeItem("token");
    return <Navigate to="/" />;
  }

  if (payload.exp * 1000 < Date.now()) {
    localStorage.removeItem("token");
    return <Navigate to="/" />;
  }

  if (allowedRoles && !allowedRoles.includes(payload.role)) {
    return <Navigate to={payload.role === "noblesse" ? "/noblesse" : "/home"} />;
  }

  return (
    <>
      {payload.role === "noblesse" ? <NoblesseWatcher /> : <IdleWatcher />}
      {children}
    </>
  );
};

export default PrivateRoute;
