import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Textarea, Input, Stack, Spinner, Image, Link, useToast,
} from "@chakra-ui/react";
import { ArrowBackIcon, AttachmentIcon } from "@chakra-ui/icons";
import FloatingWindow from "../../components/FloatingWindow";
import LangToggle from "../../components/LangToggle";
import axiosInstance from "../../utils/axiosInstance";
import useLang from "../../hooks/useLang";
import getRole from "../../utils/getRole";

// Problem reports to admin: staff write in, admin replies, both see the thread.

const NAME_KEY = "afdc.supportName";
const readName = () => { try { return window.localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } };
const saveName = (n) => { try { window.localStorage.setItem(NAME_KEY, n); } catch { /* not remembered */ } };

const when = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const errText = (err) => err.response?.data?.error || err.message;

// Message box with an optional photo; used for a new report and for replies.
const Composer = ({ t, onSend, sending, placeholder, sendLabel }) => {
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const send = async () => {
    if (await onSend(body.trim(), file)) {
      setBody(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <Stack spacing={2}>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder}
        rows={4} maxLength={4000} bg="white" />
      <Flex gap={2} align="center" wrap="wrap">
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Button size="sm" variant="outline" leftIcon={<AttachmentIcon />} onClick={() => fileRef.current?.click()}>
          {file ? t("Change photo") : t("Add photo")}
        </Button>
        {file && (
          <Text fontSize="xs" color="gray.600" noOfLines={1} maxW="180px">{file.name}</Text>
        )}
        {file && (
          <Button size="xs" variant="ghost" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>
            {t("Remove")}
          </Button>
        )}
        <Box flex={1} />
        <Button size="sm" colorScheme="blue" onClick={send} isLoading={sending}
          isDisabled={!body.trim() && !file}>
          {sendLabel}
        </Button>
      </Flex>
    </Stack>
  );
};

const StatusBadge = ({ status, t }) => (
  <Badge colorScheme={status === "fixed" ? "green" : "yellow"}>
    {status === "fixed" ? t("Fixed") : t("Open", { _as: "report" })}
  </Badge>
);

const SupportWindow = ({ isOpen, onClose, screen, refreshSignal, onChanged }) => {
  const { lang, t, toggle } = useLang();
  const toast = useToast();
  const admin = getRole() === "admin";
  // "list", "new", or a ticket id.
  const [view, setView] = useState("list");
  const [tickets, setTickets] = useState([]);
  const [thread, setThread] = useState(null);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [name, setName] = useState(readName);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get("/support-tickets",
        { params: { status: admin && filter !== "all" ? filter : undefined } });
      setTickets(data || []);
    } catch (err) {
      toast({ status: "error", position: "top", title: t("Could not load reports"), description: errText(err) });
    } finally { setLoading(false); }
  }, [admin, filter, t, toast]);

  const loadThread = useCallback(async (id) => {
    try {
      const { data } = await axiosInstance.get(`/support-tickets/${id}`);
      setThread(data);
      onChanged?.();
    } catch (err) {
      toast({ status: "error", position: "top", title: t("Could not open the report"), description: errText(err) });
      setView("list");
    }
  }, [onChanged, t, toast]);

  useEffect(() => {
    if (!isOpen) return;
    if (view === "list") loadList();
    else if (typeof view === "number") loadThread(view);
  }, [isOpen, view, loadList, loadThread]);

  // Picks up replies on the screen's 60s refresh, skipping the first render.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    if (!isOpen) return;
    if (view === "list") loadList();
    else if (typeof view === "number") loadThread(view);
  }, [refreshSignal, isOpen, view, loadList, loadThread]);

  const post = async (url, body, file) => {
    const form = new FormData();
    if (body) form.append("body", body);
    if (file) form.append("image", file);
    if (name.trim()) form.append("name", name.trim());
    if (screen) form.append("screen", screen);
    setSending(true);
    try {
      const { data } = await axiosInstance.post(url, form);
      return data || {};
    } catch (err) {
      toast({ status: "error", position: "top", title: t("Could not send"), description: errText(err) });
      return null;
    } finally { setSending(false); }
  };

  const createTicket = async (body, file) => {
    saveName(name.trim());
    const data = await post("/support-tickets", body, file);
    if (!data) return false;
    toast({ status: "success", position: "top", duration: 4000, title: t("Sent. You will see the answer here.") });
    setView(data.ticketId);
    return true;
  };

  const reply = async (body, file) => {
    const data = await post(`/support-tickets/${view}/messages`, body, file);
    if (!data) return false;
    await loadThread(view);
    return true;
  };

  const setStatus = async (status) => {
    try {
      await axiosInstance.patch(`/support-tickets/${view}`, { status });
      await loadThread(view);
    } catch (err) {
      toast({ status: "error", position: "top", title: "Could not change the status", description: errText(err) });
    }
  };

  const close = () => { setView("list"); setThread(null); onClose(); };
  const back = () => { setView("list"); setThread(null); };

  const title = view === "new" ? t("Report a problem")
    : typeof view === "number" ? `${t("Report")} #${view}`
      : admin ? "Problem reports" : t("My reports");

  return (
    <FloatingWindow isOpen={isOpen} onClose={close} title={title} width={560}
      maxHeight={{ base: "75dvh", md: "80vh" }}
      headerActions={<LangToggle lang={lang} onToggle={toggle} />}>
      {view === "list" && (
        <Stack spacing={3}>
          <Flex gap={2} align="center" wrap="wrap">
            {!admin && (
              <Button size="sm" colorScheme="blue" onClick={() => setView("new")}>{t("Report a problem")}</Button>
            )}
            {admin && [["open", "Open"], ["fixed", "Fixed"], ["all", "All"]].map(([k, label]) => (
              <Button key={k} size="xs" variant={filter === k ? "solid" : "outline"} colorScheme="gray"
                onClick={() => setFilter(k)}>{label}</Button>
            ))}
            {loading && <Spinner size="sm" />}
          </Flex>
          {!loading && tickets.length === 0 && (
            <Text fontSize="sm" color="gray.500">
              {admin ? "Nothing here." : t("No reports yet. If something is wrong, tell us here instead of calling.")}
            </Text>
          )}
          {tickets.map((tk) => (
            <Box key={tk.ticketId} as="button" textAlign="left" w="100%" p={3} borderWidth="1px" borderRadius="md"
              borderColor={tk.unread ? "blue.300" : "gray.200"} bg={tk.unread ? "blue.50" : "white"}
              _hover={{ bg: "gray.50" }} onClick={() => setView(tk.ticketId)}>
              <Flex justify="space-between" align="center" gap={2}>
                <Text fontSize="sm" fontWeight="semibold">
                  #{tk.ticketId}
                  {admin && ` · ${tk.reporterName || tk.createdBy}`}
                  {tk.unread && <Badge ml={2} colorScheme="blue">{t("New")}</Badge>}
                </Text>
                <StatusBadge status={tk.status} t={t} />
              </Flex>
              <Text fontSize="sm" color="gray.700" noOfLines={2} mt={1}>{tk.firstMessage || t("(photo)")}</Text>
              <Text fontSize="xs" color="gray.500" mt={1}>
                {when(tk.updatedAt)}{tk.screen ? ` · ${tk.screen}` : ""}
              </Text>
            </Box>
          ))}
        </Stack>
      )}

      {view === "new" && (
        <Stack spacing={3}>
          <Button size="sm" variant="ghost" alignSelf="flex-start" leftIcon={<ArrowBackIcon />} onClick={back}>
            {t("Back", { _as: "nav" })}
          </Button>
          <Text fontSize="sm" color="gray.600">
            {t("Say what you were doing and what went wrong. A photo or screenshot helps.")}
          </Text>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Your name")} maxLength={80} />
          <Composer t={t} onSend={createTicket} sending={sending}
            placeholder={t("What happened?")} sendLabel={t("Send")} />
        </Stack>
      )}

      {typeof view === "number" && (
        <Stack spacing={3}>
          <Flex justify="space-between" align="center" gap={2}>
            <Button size="sm" variant="ghost" leftIcon={<ArrowBackIcon />} onClick={back}>{t("Back", { _as: "nav" })}</Button>
            {thread && (
              <Flex gap={2} align="center">
                <StatusBadge status={thread.status} t={t} />
                {admin && (
                  <Button size="xs" variant="outline" colorScheme={thread.status === "fixed" ? "gray" : "green"}
                    onClick={() => setStatus(thread.status === "fixed" ? "open" : "fixed")}>
                    {thread.status === "fixed" ? "Reopen" : "Mark fixed"}
                  </Button>
                )}
              </Flex>
            )}
          </Flex>
          {!thread ? <Spinner size="sm" /> : (
            <>
              {admin && (
                <Text fontSize="xs" color="gray.500">
                  {thread.createdBy}{thread.screen ? ` · ${thread.screen}` : ""} · {when(thread.createdAt)}
                </Text>
              )}
              {thread.messages.map((m) => (
                <Box key={m.messageId} alignSelf={m.fromAdmin === admin ? "flex-end" : "flex-start"} maxW="85%"
                  bg={m.fromAdmin ? "blue.50" : "gray.100"} borderRadius="md" px={3} py={2}>
                  <Text fontSize="xs" color="gray.500" mb={1}>
                    {m.fromAdmin ? t("Admin") : m.author} · {when(m.createdAt)}
                  </Text>
                  {m.body && <Text fontSize="sm" whiteSpace="pre-wrap">{m.body}</Text>}
                  {m.imageUrl && (
                    <Link href={m.imageUrl} isExternal>
                      <Image src={m.imageUrl} alt="" maxH="220px" mt={m.body ? 2 : 0} borderRadius="md" />
                    </Link>
                  )}
                </Box>
              ))}
              <Composer t={t} onSend={reply} sending={sending}
                placeholder={admin ? "Reply" : t("Write a reply")} sendLabel={t("Send")} />
            </>
          )}
        </Stack>
      )}
    </FloatingWindow>
  );
};

export default SupportWindow;
