import React from "react";
import Checkbox from "@skbkontur/react-ui/Checkbox";
import Gapped from "@skbkontur/react-ui/Gapped";
import ArrowTriangleRightIcon from "@skbkontur/react-icons/ArrowTriangleRight";
import DeleteIcon from "@skbkontur/react-icons/Delete";
import OkIcon from "@skbkontur/react-icons/Ok";
import HelpDotIcon from "@skbkontur/react-icons/HelpDot";
import { isTest } from "../types";
import { Suite, Test, CreeveyContex } from "./CreeveyContext";
import Spinner from "@skbkontur/react-ui/Spinner";

interface TestTreeProps {
  title: string;
  tests: Suite | Test;
}

interface TestTreeState {
  opened: boolean;
}

export class TestTree extends React.Component<TestTreeProps, TestTreeState> {
  static contextType = CreeveyContex;
  context: React.ContextType<typeof CreeveyContex> = this.context;
  state: TestTreeState = { opened: false };
  checkbox = React.createRef<Checkbox>();

  componentDidUpdate(prevProps: TestTreeProps) {
    if (!this.checkbox.current || isTest(prevProps.tests) || isTest(this.props.tests)) {
      return;
    }
    if (!prevProps.tests.indeterminate && this.props.tests.indeterminate) {
      this.checkbox.current.setIndeterminate();
    }
    if (prevProps.tests.indeterminate && !this.props.tests.indeterminate) {
      this.checkbox.current.resetIndeterminate();
    }
  }
  render() {
    const { tests } = this.props;
    const checkbox = (
      <Gapped gap={5}>
        <Checkbox ref={this.checkbox} checked={tests.checked} onChange={this.handleCheck} />
        {this.props.title}
      </Gapped>
    );
    if (isTest(tests)) {
      return (
        <div style={{ marginLeft: "20px" }}>
          <Gapped gap={5}>
            {checkbox} {this.renderStatus(tests)}
          </Gapped>
        </div>
      );
    }
    return (
      <>
        <Gapped gap={5}>
          <span
            style={{
              display: "inline-block",
              cursor: "pointer",
              transform: this.state.opened ? "rotate(45deg)" : ""
            }}
          >
            <ArrowTriangleRightIcon onClick={this.handleSubTreeOpen} />
          </span>
          {checkbox}
        </Gapped>
        {this.state.opened && (
          <div style={{ marginLeft: "20px" }}>
            {Object.entries(tests.children).map(([title, suite]) => (
              <TestTree key={title} title={title} tests={suite} />
            ))}
          </div>
        )}
      </>
    );
  }

  renderStatus(test: Test) {
    if (!test.result) return null;
    const { result, retries } = test;

    switch (result[retries].status) {
      case "failed": {
        return <DeleteIcon color="red" />;
      }
      case "success": {
        return <OkIcon color="green" />;
      }
      case "running": {
        return <Spinner type="mini" />;
      }
      case "pending": {
        return <HelpDotIcon color="blue" />;
      }
      default: {
        return null;
      }
    }
  }

  handleSubTreeOpen = () => this.setState(({ opened }) => ({ opened: !opened }));
  handleCheck = (_: React.ChangeEvent, checked: boolean) => {
    this.context.onTestToogle(this.props.tests.path, checked);
  };
}