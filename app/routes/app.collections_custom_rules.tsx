import { useState } from "react";
import {
  Button,
  Card,
  TextField,
  Select,
  Layout,
  TextContainer,
  Divider,
  InlineStack,
  BlockStack,
  Grid,
  Page,
  Icon,
} from "@shopify/polaris";
import { ChevronUpIcon, ChevronDownIcon } from "@shopify/polaris-icons";

interface TagRule {
  id: string;
  name: string;
  position: string;
}

const ManageTags = () => {
  const [sortByTags, setSortByTags] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagPosition, setTagPosition] = useState("top");
  const [tagRules, setTagRules] = useState<TagRule[]>([]);

  const handleAddTag = () => {
    if (tagName.trim()) {
      setTagRules([
        ...tagRules,
        {
          id: Date.now().toString(),
          name: tagName,
          position: tagPosition,
        },
      ]);
      setTagName("");
    }
  };

  const handleClearPosition = (position: string) => {
    setTagRules(tagRules.filter((rule) => rule.position !== position));
  };

  const positions = [
    { value: "top", label: "Top of collection / After featured products" },
    { value: "after-new", label: "After new products" },
    { value: "before-out-of-stock", label: "Before out of stock products" },
    { value: "bottom", label: "Bottom of collection / After out of stock products" },
  ];

  const positionOptions = positions.map((pos) => ({
    label: pos.label,
    value: pos.value,
  }));

  return (
    <Page
      title="Manage Tags"
      primaryAction={{ content: "Save Settings" }}
    >
      <Layout>
        <Layout.Section>
          {/* Sort by Tags Card */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <TextContainer>
                    <h2>Sort by Tags</h2>
                  </TextContainer>
                  <TextContainer>
                    <p>
                      Available for any primary sorting order except "Manual". Define sorting rules for
                      products with specific tags.
                    </p>
                  </TextContainer>
                </BlockStack>
                <button
                  type="button"
                  className={`Polaris-Button Polaris-Button--toggle ${sortByTags ? 'Polaris-Button--selected' : ''}`}
                  onClick={() => setSortByTags(!sortByTags)}
                  aria-pressed={sortByTags}
                  style={{ minWidth: '60px' }}
                >
                  <span className="Polaris-Button__Content">
                    <span className="Polaris-Button__Icon">
                      <span className="Polaris-Icon">
                        <span className="Polaris-Icon__Svg">
                          <svg viewBox="0 0 20 20" className="Polaris-Icon__Svg" focusable="false" aria-hidden="true">
                            <path d="M7 9h6a1 1 0 010 2H7a1 1 0 010-2z"></path>
                          </svg>
                        </span>
                      </span>
                    </span>
                    <span className="Polaris-Button__Text">{sortByTags ? 'On' : 'Off'}</span>
                  </span>
                </button>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Specify Tags Card */}
          <div style={{ opacity: sortByTags ? 1 : 0.4, pointerEvents: sortByTags ? "auto" : "none" }}>
            <Card>
              <BlockStack gap="400">
                <TextContainer>
                  <h2>Specify Tags</h2>
                </TextContainer>
                <TextContainer>
                  <p>
                    Type the tag name that you want to apply sorting rules to. This must be an existing
                    tag. Then specify a position for products with this tag.
                  </p>
                </TextContainer>

                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <TextField
                      label="Tag name"
                      id="tag-name"
                      placeholder="Tag name"
                      value={tagName}
                      onChange={setTagName}
                      disabled={!sortByTags}
                      autoComplete="off"
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <Select
                      label="Position"
                      id="position"
                      options={positionOptions}
                      value={tagPosition}
                      onChange={setTagPosition}
                      disabled={!sortByTags}
                    />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <div style={{ marginTop: "22px" }}>
                      <Button
                        onClick={handleAddTag}
                        disabled={!sortByTags || !tagName.trim()}
                      >
                        Add a Tag
                      </Button>
                    </div>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </Card>

            {/* Drag and Drop Info Card */}
            <Card>
              <div style={{ padding: "20px", textAlign: "center" }}>
                <div style={{ marginBottom: "8px" }}>
                  <InlineStack gap="200">
                    <Icon source={ChevronUpIcon} />
                    <Icon source={ChevronDownIcon} />
                  </InlineStack>
                </div>
                <TextContainer>
                  <p>Move tags up/down in the list by dragging them.</p>
                  <p>
                    Use mouse click to select/deselect and move multiple items. Click outside to clear
                    all selections.
                  </p>
                </TextContainer>
              </div>
            </Card>

            {/* Tag Rules List Card */}
            <Card>
              <BlockStack gap="200">
                {positions.map((pos) => {
                  const rulesAtPosition = tagRules.filter((rule) => rule.position === pos.value);
                  return (
                    <div key={pos.value}>
                      <InlineStack align="space-between">
                        <TextContainer>
                          <span style={{ fontWeight: '500' }}>{pos.label}</span>
                          {rulesAtPosition.length > 0 && (
                            <span style={{ color: "#6d7175", fontSize: "14px" }}>
                              (if they are set)
                            </span>
                          )}
                        </TextContainer>
                        {rulesAtPosition.length > 0 && (
                          <Button
                            variant="plain"
                            onClick={() => handleClearPosition(pos.value)}
                            disabled={!sortByTags}
                          >
                            clear
                          </Button>
                        )}
                      </InlineStack>
                    </div>
                  );
                })}
              </BlockStack>
            </Card>

            {/* Import/Export Card */}
            <Card>
              <BlockStack gap="400">
                <TextContainer>
                  <h2>Import/Export Tags List</h2>
                </TextContainer>
                <TextContainer>
                  <p>
                    You can import tags instead of adding them manually above. Click "Export" to download
                    your tags sample file. Edit this file to suit your needs and import back.
                  </p>
                </TextContainer>
                <InlineStack gap="200">
                  <Button variant="secondary" disabled={!sortByTags}>
                    Export Tags
                  </Button>
                  <span style={{ color: "#6d7175", fontSize: "14px" }}>or</span>
                  <Button variant="secondary" disabled={!sortByTags}>
                    Import Tags
                  </Button>
                </InlineStack>
                <Button variant="plain" disabled={!sortByTags}>
                  How to create a correct .CSV file?
                </Button>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <div style={{ padding: "16px" }}>
              <InlineStack align="space-between">
                <Button variant="secondary">Reset All to Default</Button>
                <Button>Save Settings</Button>
              </InlineStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default ManageTags;