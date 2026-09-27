import {
  BriefcaseBusiness,
  CircleDollarSign,
  Heart,
  Laptop,
  Palette,
  SquareCheck,
  Users,
  Plus,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { GoalSheet } from "./sheet";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { colors } from "../theme";

const goalCategories = [
  { name: "Health", title: "Create a health goal", icon: Heart },
  { name: "Relationships", title: "Create a relationship goal", icon: Users },
  {
    name: "Finances",
    title: "Create a financial goal",
    icon: CircleDollarSign,
  },
  { name: "Career", title: "Create a career goal", icon: BriefcaseBusiness },
  {
    name: "Interests",
    title: "Create a goal for your interests",
    icon: Palette,
  },
  { name: "Productivity", title: "Create a productivity goal", icon: Laptop },
  { name: "Something else", title: "Create a goal", icon: SquareCheck },
];

export function GoalCreation({
  onCreate,
}: {
  readonly onCreate: (category: string) => void;
}) {
  const [category, setCategory] = useState<(typeof goalCategories)[number]>();
  return (
    <>
      <View style={pageStyles.section}>
        <Text accessibilityRole="header" style={pageStyles.heading}>
          Create a goal
        </Text>
        {goalCategories.map(({ name, icon: Icon, ...item }) => (
          <Pressable
            accessibilityRole="button"
            key={name}
            onPress={() => {
              setCategory({ ...item, name, icon: Icon });
            }}
            style={pageStyles.row}
          >
            <Icon size={23} color={colors.muted} strokeWidth={1.7} />
            <Text style={[pageStyles.rowTitle, { flex: 1 }]}>{name}</Text>
            <Plus size={18} color={colors.muted} />
          </Pressable>
        ))}
      </View>
      {category && (
        <GoalSheet
          title={category.title}
          onClose={() => {
            setCategory(undefined);
          }}
        >
          <Text style={pageStyles.copy}>
            Let’s work out what you want to achieve together. Zoen will ask a
            few questions, then save the goal and track your progress here.
          </Text>
          <ActionButton
            onPress={() => {
              setCategory(undefined);
              onCreate(category.name);
            }}
          >
            Let’s go
          </ActionButton>
        </GoalSheet>
      )}
    </>
  );
}
