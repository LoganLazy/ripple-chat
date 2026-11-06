import type { ChatRoom } from "./types";
const now = new Date();
now.setHours(10, 20, 0, 0);
const time = now.getTime();
export const demoRooms: ChatRoom[] = [
  {
    id: "design",
    name: "设计漫游指南",
    description: "把灵感放在这里，让好想法慢慢生长。",
    color: "purple",
    symbol: "✳",
    unread: 0,
    members: [
      { id: "lin", name: "林间" },
      { id: "summer", name: "夏天" },
      { id: "zhou", name: "周也" },
      { id: "me", name: "我" },
    ],
    messages: [
      {
        id: "d1",
        sender: "lin",
        name: "林间",
        text: "早上好呀，大家 ☀️\n最近在收集一些让人感觉舒服的设计，发现「留白」真的很有魔力。",
        time,
      },
      {
        id: "d2",
        sender: "summer",
        name: "夏天",
        text: "分享一张今天的灵感板。柔和一点，轻盈一点，给想法留一点呼吸的空间。",
        time: time + 120000,
      },
      {
        id: "d3",
        sender: "summer",
        name: "夏天",
        text: "留一点空白，让灵感发生。",
        time: time + 125000,
        kind: "image",
        url: "/inspiration.svg",
      },
      {
        id: "d4",
        sender: "me",
        name: "我",
        text: "喜欢这个方向！像周末午后的一阵微风 🌿",
        time: time + 240000,
        own: true,
      },
      {
        id: "d5",
        sender: "zhou",
        name: "周也",
        text: "那我们就从一个小小的想法开始吧。\n不着急，好东西值得慢慢打磨。",
        time: time + 300000,
      },
    ],
  },
  {
    id: "summer",
    name: "夏天",
    description: "今天也要收集一点美好。",
    color: "peach",
    symbol: "夏",
    direct: true,
    unread: 2,
    members: [
      { id: "summer", name: "夏天" },
      { id: "me", name: "我" },
    ],
    messages: [
      {
        id: "s1",
        sender: "summer",
        name: "夏天",
        text: "周末要不要一起去看新的设计展？",
        time: time + 400000,
      },
      {
        id: "s2",
        sender: "summer",
        name: "夏天",
        text: "听说有很棒的独立出版物 📚",
        time: time + 420000,
      },
    ],
  },
  {
    id: "cafe",
    name: "周末咖啡馆",
    description: "咖啡、闲聊，以及生活里不着急的部分。",
    color: "sand",
    symbol: "☕",
    unread: 3,
    members: [
      { id: "an", name: "阿安" },
      { id: "me", name: "我" },
    ],
    messages: [
      {
        id: "c1",
        sender: "an",
        name: "阿安",
        text: "今天的手冲是埃塞豆，有淡淡的花香。你们喝了什么？",
        time: time - 1800000,
      },
    ],
  },
  {
    id: "product",
    name: "造点有趣的",
    description: "保持好奇，把想法做成真的。",
    color: "mint",
    symbol: "↗",
    unread: 0,
    members: [
      { id: "zhou", name: "周也" },
      { id: "me", name: "我" },
    ],
    messages: [
      {
        id: "p1",
        sender: "zhou",
        name: "周也",
        text: "新的原型已经准备好，随时来玩。",
        time: time - 3600000,
      },
    ],
  },
  {
    id: "lin",
    name: "林间",
    description: "散步的时候，想法会自己出现。",
    color: "blue",
    symbol: "林",
    direct: true,
    unread: 0,
    members: [
      { id: "lin", name: "林间" },
      { id: "me", name: "我" },
    ],
    messages: [
      {
        id: "l1",
        sender: "lin",
        name: "林间",
        text: "收到，明天见 👋",
        time: time - 86400000,
      },
    ],
  },
  {
    id: "music",
    name: "耳机里的宇宙",
    description: "分享今天的单曲循环。",
    color: "rose",
    symbol: "♫",
    unread: 0,
    members: [
      { id: "summer", name: "夏天" },
      { id: "me", name: "我" },
    ],
    messages: [
      {
        id: "m1",
        sender: "summer",
        name: "夏天",
        text: "适合下雨天听的歌，又多了一首。",
        time: time - 90000000,
      },
    ],
  },
];
