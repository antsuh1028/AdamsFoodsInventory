import React, { useState } from "react";
import getRole from "../../utils/getRole";
import {
  Text,
  Button,
  ButtonGroup,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  HStack,
  Box,
  UnorderedList,
  ListItem,
  Badge,
} from "@chakra-ui/react";

const features = [
  {
    tab: "Inventory Tabs",
    roles: ["user", "manager", "admin"],
    en: {
      title: "Inventory Tabs",
      intro: "Items are organized into tabs at the top of the screen.",
      points: [
        "Level 1, 2, 3 — items stored on each floor, grouped by location.",
        "Other — items not on floors 1–3 (e.g. chilling rooms, staging areas).",
        "To Noblesse — pending production orders and items physically at NOBLESSE TRADING.",
        "From Noblesse — all processed items returned from Noblesse (lot starts with 'N').",
        "Use the search bar to filter by lot, vendor, species, or location across the active tab.",
        "Click any item card to open its detail panel on the right side.",
      ],
    },
    ko: {
      title: "인벤토리 탭",
      intro: "아이템은 화면 상단의 탭으로 구분되어 있습니다.",
      points: [
        "Level 1, 2, 3 — 각 층에 저장된 아이템, 위치별로 그룹화.",
        "Other — 1~3층 이외의 위치에 있는 아이템 (예: 냉장실, 스테이징 구역).",
        "To Noblesse — 대기 중인 생산 주문 및 현재 NOBLESSE TRADING에 있는 아이템.",
        "From Noblesse — Noblesse에서 반환된 모든 가공 아이템 (로트가 'N'으로 시작).",
        "검색창으로 현재 탭에서 로트, 공급업체, 종류, 위치로 필터링할 수 있습니다.",
        "아이템 카드를 클릭하면 오른쪽에 상세 패널이 열립니다.",
      ],
    },
  },
  {
    tab: "Add Item",
    roles: ["manager", "admin"],
    en: {
      title: "Adding an Item",
      intro: "Fill out the form to create a new inventory record.",
      points: [
        "Fill out the form with the item's details and click Add.",
        "Required fields: location, lot number, vendor, species, weight, quantity.",
        "Location codes follow the format: letter(s) + floor digit + 2 digits (e.g. A101, B203). Locations will be verified.",
        "Species is always stored in uppercase — enter it in any case.",
        "Use the scanner to auto-fill fields from a pallet form instead of typing manually.",
        "After adding, the item appears in the tab matching its floor location.",
      ],
    },
    ko: {
      title: "아이템 추가",
      intro: "양식을 작성하여 새 인벤토리 기록을 생성합니다.",
      points: [
        "아이템 정보를 양식에 입력하고 Add를 클릭하세요.",
        "필수 항목: 위치, 로트 번호, 공급업체, 종류, 무게, 수량.",
        "위치 코드 형식: 문자 + 층 번호 + 2자리 숫자 (예: A101, B203). 위치는 자동으로 검증됩니다.",
        "종류(Species)는 항상 대문자로 저장됩니다 — 어떤 형식으로 입력해도 됩니다.",
        "스캐너를 사용하면 팔레트 양식에서 자동으로 필드를 채울 수 있습니다.",
        "추가 후 아이템은 해당 층 탭에 나타납니다.",
      ],
    },
  },
  {
    tab: "Details & Editing",
    roles: ["user", "manager", "admin"],
    en: {
      title: "Item Details & Inline Editing",
      intro: "Click any item to open its detail panel. All fields can be edited without leaving the screen.",
      points: [
        "Double-click any field to enter edit mode.",
        "After Editing, a confirmation will show up",
        "Editable fields: lot, vendor, brand, species, grade, type, price, pack date, received date, estimated weight, description.",
        "'Locate' flashes the item's slot on the freezer map.",
        "'Print' prints the item label.",
        "Production history (what was sent / returned) is shown in a collapsible section.",
      ],
    },
    ko: {
      title: "아이템 상세 및 인라인 수정",
      intro: "아이템을 클릭하면 상세 패널이 열립니다. 화면을 벗어나지 않고 모든 필드를 수정할 수 있습니다.",
      points: [
        "필드를 더블클릭하면 편집 모드가 됩니다.",
        "수정 후 확인 창이 나타납니다.",
        "편집 가능한 항목: 로트, 공급업체, 브랜드, 종류, 등급, 타입, 가격, 포장일, 입고일, 예상 무게, 설명.",
        "'Locate'는 냉동고 지도에서 해당 슬롯을 강조 표시합니다.",
        "'Print'는 아이템 라벨을 인쇄합니다.",
        "생산 기록 (발송/반환 내역)은 접을 수 있는 섹션에 표시됩니다.",
      ],
    },
  },
  {
    tab: "Box Management",
    roles: ["user", "manager", "admin"],
    en: {
      title: "Box Management",
      intro: "Each inventory item tracks individual boxes and their weights. Total weight and quantity update automatically.",
      points: [
        "Boxes are shown as chips in the detail panel.",
        "Bulk add: enter a count and weight per box, then click 'Add Boxes' to add all at once.",
        "Single add: enter a weight and click 'Add Box'.",
        "Click the X on a box chip to remove it — a short undo window appears after removal.",
        "Total weight recalculates automatically after every add or remove.",
        "Removing all boxes leaves the item with weight 0 — the record stays until manually deleted.",
      ],
    },
    ko: {
      title: "박스 관리",
      intro: "각 인벤토리 아이템은 개별 박스와 무게를 추적합니다. 총 무게와 수량은 자동으로 업데이트됩니다.",
      points: [
        "박스는 상세 패널에서 칩 형태로 표시됩니다.",
        "일괄 추가: 수량과 박스당 무게를 입력하고 'Add Boxes'를 클릭하세요.",
        "단일 추가: 무게를 입력하고 'Add Box'를 클릭하세요.",
        "박스 칩의 X를 클릭하면 제거됩니다 — 제거 후 잠시 실행 취소 창이 나타납니다.",
        "추가 또는 제거 후 총 무게가 자동으로 다시 계산됩니다.",
        "모든 박스를 제거하면 무게가 0이 된 상태로 기록이 남습니다 — 수동으로 삭제해야 합니다.",
      ],
    },
  },
  {
    tab: "Scanner",
    roles: ["manager", "admin"],
    en: {
      title: "Scanner (OCR)",
      intro: "Upload a pallet form or order sheet to automatically extract inventory fields.",
      points: [
        "Click the scanner icon in the navbar to open the scanner.",
        "Upload a photo or PDF of the document.",
        "The system will try its best to read and extract fields.",
        "Extracted fields: lot number, vendor, species, weight, pack date, and more.",
        "Species is automatically converted to uppercase after extraction.",
        "Always review extracted values before confirming — OCR can make mistakes.",
        "Supports Adams Foods pallet forms, pick sheets, and Bill of Lading grid formats.",
      ],
    },
    ko: {
      title: "스캐너 (OCR)",
      intro: "팔레트 양식이나 주문서를 업로드하여 인벤토리 필드를 자동으로 추출합니다.",
      points: [
        "네비게이션 바의 스캐너 아이콘을 클릭하여 스캐너를 여세요.",
        "문서의 사진이나 PDF를 업로드하세요.",
        "시스템이 최대한 정확하게 필드를 읽고 추출합니다.",
        "추출 필드: 로트 번호, 공급업체, 종류, 무게, 포장일 등.",
        "추출 후 종류(Species)는 자동으로 대문자로 변환됩니다.",
        "확인하기 전에 항상 추출된 값을 검토하세요 — OCR이 실수할 수 있습니다.",
        "Adams Foods 팔레트 양식, 픽 시트, Bill of Lading 그리드 형식을 지원합니다.",
      ],
    },
  },
  {
    tab: "Send to Noblesse",
    roles: ["manager", "admin"],
    en: {
      title: "Send to Noblesse",
      intro: "Send inventory items to Noblesse Trading for processing.",
      points: [
        "Only available when an item is in a chilling or floor location (e.g. A101, CHILL01).",
        "The 'Send to Noblesse' section appears at the bottom of the details panel.",
        "Select which boxes to send and choose a send date.",
        "Click 'Send' to create a production order — the item moves to NOBLESSE TRADING location.",
        "Sent items appear in the 'To Noblesse' tab until returned.",
        "Production history in the details panel shows all past sends for that item.",
      ],
    },
    ko: {
      title: "Noblesse로 보내기",
      intro: "인벤토리 아이템을 가공을 위해 Noblesse Trading으로 보냅니다.",
      points: [
        "냉장 또는 층 위치에 있는 아이템에서만 사용 가능합니다 (예: A101, CHILL01).",
        "상세 패널 하단에 'Send to Noblesse' 섹션이 나타납니다.",
        "보낼 박스를 선택하고 발송 날짜를 선택하세요.",
        "'Send'를 클릭하면 생산 주문이 생성되고 아이템이 NOBLESSE TRADING으로 이동합니다.",
        "보낸 아이템은 반환될 때까지 'To Noblesse' 탭에 표시됩니다.",
        "상세 패널의 생산 기록에서 해당 아이템의 모든 발송 기록을 확인할 수 있습니다.",
      ],
    },
  },
  {
    tab: "Return from Noblesse",
    roles: ["manager", "admin"],
    en: {
      title: "Return from Noblesse",
      intro: "Record items coming back from Noblesse as processed inventory.",
      points: [
        "Only available when an item is at NOBLESSE TRADING location.",
        "Click 'Return Items' in the details panel to open the return form.",
        "Add one row per returned lot — each with a new lot number, destination location, and description.",
        "Add boxes by entering count × weight and clicking 'Add', or enter a total weight directly.",
        "Each return row becomes a new processed (prc) item, linked to the original via source ID.",
        "Multiple partial returns with different lot numbers can be submitted at once.",
        "Returned items appear in the 'From Noblesse' tab (lot starts with 'N').",
      ],
    },
    ko: {
      title: "Noblesse에서 반환",
      intro: "Noblesse에서 돌아오는 아이템을 가공 인벤토리로 기록합니다.",
      points: [
        "아이템이 NOBLESSE TRADING 위치에 있을 때만 사용 가능합니다.",
        "상세 패널의 'Return Items'를 클릭하여 반환 양식을 여세요.",
        "반환 로트당 행 하나를 추가하세요 — 새 로트 번호, 목적지 위치, 설명을 입력합니다.",
        "수량 × 무게를 입력하고 'Add'를 클릭하거나, 총 무게를 직접 입력할 수 있습니다.",
        "각 반환 행은 소스 ID를 통해 원본과 연결된 새로운 가공(prc) 아이템이 됩니다.",
        "다른 로트 번호로 여러 부분 반환을 한 번에 제출할 수 있습니다.",
        "반환된 아이템은 'From Noblesse' 탭에 표시됩니다 (로트가 'N'으로 시작).",
      ],
    },
  },
  {
    tab: "History & Restore",
    roles: ["user", "manager", "admin"],
    en: {
      title: "History Log & Restore",
      intro: "Every change to inventory is logged. Removed items can be restored.",
      points: [
        "Open the history log from the navbar (clock icon).",
        "Shows all changes: Added, Updated, Removed — with timestamp and item details.",
        "Switch between card view and spreadsheet view using the toggle.",
        "Use the search bar to find history entries by lot, location, or vendor.",
        "Click any entry to expand it and see the full before/after details.",
        "Removed entries show a green Restore button — clicking it re-adds the item.",
        "Restore always works regardless of whether the destination location is already occupied.",
      ],
    },
    ko: {
      title: "기록 및 복원",
      intro: "인벤토리의 모든 변경 사항이 기록됩니다. 제거된 아이템은 복원할 수 있습니다.",
      points: [
        "네비게이션 바의 시계 아이콘을 클릭하여 기록 로그를 여세요.",
        "모든 변경 사항 표시: 추가, 수정, 제거 — 타임스탬프 및 아이템 상세 포함.",
        "토글을 사용하여 카드 보기와 스프레드시트 보기 간에 전환하세요.",
        "검색창으로 로트, 위치, 공급업체로 기록 항목을 찾을 수 있습니다.",
        "항목을 클릭하면 전체 변경 전/후 상세 내용을 볼 수 있습니다.",
        "제거된 항목에는 녹색 복원 버튼이 표시됩니다 — 클릭하면 아이템이 다시 추가됩니다.",
        "위치 점유 여부에 관계없이 복원은 항상 성공합니다.",
      ],
    },
  },
  {
    tab: "Production Orders",
    roles: ["manager", "admin"],
    en: {
      title: "Production Orders",
      intro: "View and manage all orders sent to Noblesse Trading.",
      points: [
        "Open from the navbar (production orders icon).",
        "Lists all orders with send date, items, and box details.",
        "Click an order to expand it and see full details.",
        "Use the Return button on an order to process items coming back.",
        "The return form pre-fills species from the original item — just enter lot, location, and weight.",
        "Returned items are linked to the original raw item via source ID for full traceability.",
      ],
    },
    ko: {
      title: "생산 주문",
      intro: "Noblesse Trading으로 보낸 모든 주문을 보고 관리합니다.",
      points: [
        "네비게이션 바의 생산 주문 아이콘을 클릭하여 여세요.",
        "발송일, 아이템, 박스 상세가 포함된 모든 주문 목록이 표시됩니다.",
        "주문을 클릭하면 전체 상세 내용을 볼 수 있습니다.",
        "주문의 반환 버튼을 사용하여 반환되는 아이템을 처리하세요.",
        "반환 양식은 원본 아이템에서 종류(Species)를 자동으로 채웁니다 — 로트, 위치, 무게만 입력하면 됩니다.",
        "반환된 아이템은 소스 ID를 통해 원본 원자재 아이템과 연결되어 완전한 추적이 가능합니다.",
      ],
    },
  },
  {
    tab: "Remove Item",
    roles: ["manager", "admin"],
    en: {
      title: "Removing an Item",
      intro: "Items can be removed from inventory. All removals are logged and can be restored.",
      points: [
        "Find, and Set the item you want to remove, then click the Remove button at the bottom of the details panel.",
        "The item is permanently removed from the active inventory list.",
        "A full record is saved to the history log automatically.",
        "To recover a removed item, open History and click Restore on the entry.",
        "Removing an item does not affect its production history or linked records.",
      ],
    },
    ko: {
      title: "아이템 제거",
      intro: "아이템을 인벤토리에서 제거할 수 있습니다. 모든 제거는 기록되며 복원할 수 있습니다.",
      points: [
        "제거할 아이템을 찾아 선택한 후, 상세 패널 하단의 Remove 버튼을 클릭하세요.",
        "아이템은 활성 인벤토리 목록에서 영구적으로 제거됩니다.",
        "전체 기록이 자동으로 기록 로그에 저장됩니다.",
        "제거된 아이템을 복구하려면 기록을 열고 해당 항목의 복원을 클릭하세요.",
        "아이템 제거는 생산 기록이나 연결된 기록에 영향을 주지 않습니다.",
      ],
    },
  },
];

function FeaturePanel({ en, ko, lang }) {
  const content = lang === "en" ? en : ko;
  const badge = lang === "en"
    ? <Badge colorScheme="blue" mb={3}>English</Badge>
    : <Badge colorScheme="green" mb={3}>한국어</Badge>;

  return (
    <Box w="100%">
      {badge}
      <Text fontWeight="bold" fontSize="md" mb={1}>{content.title}</Text>
      <Text fontSize="sm" color="gray.600" mb={3}>{content.intro}</Text>
      <UnorderedList spacing={1.5} pl={1}>
        {content.points.map((p, i) => (
          <ListItem key={i} fontSize="sm">{p}</ListItem>
        ))}
      </UnorderedList>
    </Box>
  );
}

function OpenHelp({ isOpen, onClose }) {
  const [lang, setLang] = useState("en");
  const role = getRole();
  const visible = features.filter((f) => f.roles.includes(role));

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent maxH="85vh">
        <ModalHeader>
          <HStack justify="space-between" pr={8}>
            <Text>Help & Manual</Text>
            <ButtonGroup size="sm" isAttached variant="outline">
              <Button
                onClick={() => setLang("en")}
                colorScheme={lang === "en" ? "blue" : "gray"}
                variant={lang === "en" ? "solid" : "outline"}
              >
                English
              </Button>
              <Button
                onClick={() => setLang("ko")}
                colorScheme={lang === "ko" ? "green" : "gray"}
                variant={lang === "ko" ? "solid" : "outline"}
              >
                한국어
              </Button>
            </ButtonGroup>
          </HStack>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={4}>
          <Tabs variant="enclosed" isLazy>
            <TabList flexWrap="wrap" borderBottom="none">
              {visible.map((f) => (
                <Tab key={f.tab} whiteSpace="nowrap" fontSize="sm">{f.tab}</Tab>
              ))}
            </TabList>
            <TabPanels>
              {visible.map((f) => (
                <TabPanel key={f.tab} pt={4}>
                  <FeaturePanel en={f.en} ko={f.ko} lang={lang} />
                </TabPanel>
              ))}
            </TabPanels>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default OpenHelp;
